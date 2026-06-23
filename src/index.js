// src/index.js
// Main entry point — generic SciFi Transformation Video Pipeline.
// Subject-specific content (which deity/location/product/business this run
// is about) is loaded at runtime from a theme file (see themes/*.json and
// src/utils/themeLoader.js) via --theme <name> or the DEFAULT_THEME env var.

require('dotenv').config();
const { Command } = require('commander');
const chalk = require('chalk');
const ora = require('ora');
const logger = require('./utils/logger');
const VideoGenerator = require('./video/generator');
const AudioGenerator = require('./audio/generator');
const VideoAssembler = require('./assembly/assembler');
const Publisher = require('./publish/publisher');
const costTracker = require('./utils/costTracker');
const cronManager = require('./utils/cronManager');
const reviewQueue = require('./utils/reviewQueue');
const phaseGate = require('./utils/phaseGate');
const config = require('../config/pipeline.config');
const { loadTheme, listThemes } = require('./utils/themeLoader');
const { enqueueVideoRun } = require('./queue/producer');
const prisma = require('./utils/db');

const program = new Command();

// Best-effort Postgres sync of VideoRun.status/phase as the pipeline
// progresses. Deliberately non-fatal: runPipeline() is also invoked
// directly by the plain `npm run generate` CLI with no DB/Docker stack
// running at all, and a run that was never created via admin/server.js's
// POST /api/pipeline/start has no VideoRun row to update. Previously
// nothing in this file ever touched Postgres, so worker.js's BullMQ path
// left every successful run stuck at status:'running' forever (#112).
async function syncRunState(runId, data) {
  if (!runId) return;
  try {
    await prisma.videoRun.update({ where: { id: runId }, data });
  } catch (error) {
    logger.debug('Skipping VideoRun DB sync (no matching row, or DB unavailable)', {
      runId,
      error: error.message,
    });
  }
}

// Pause point for the true per-phase review gate (#113). Persists
// everything runPipeline() needs to resume (the VideoGenerator's
// phaseNResult objects + usage accrued so far) to phaseGate.js's flat
// file, syncs Prisma to a distinct 'awaiting_phase_review' status (kept
// apart from reviewQueue.js's 'held_for_review' so the dashboard can tell
// the two gates apart), and returns normally — this is a successful pause,
// not a failure. The BullMQ job this ran inside completes normally once
// this returns; resuming requires admin/server.js to enqueue a brand new
// job with a distinct jobId (see src/queue/producer.js's jobId override).
async function pauseForPhaseReview({ runId, theme, phase, clipUrl, state }) {
  await phaseGate.enqueuePhase({ runId, theme: theme.id, phase, videoUrl: clipUrl, state });
  await syncRunState(runId, { status: 'awaiting_phase_review', phase });
  console.log(chalk.yellow(`\n⏸  Phase ${phase} complete — held for review. Approve via the admin API (/api/phase-review/pending) to continue.\n`));
  logger.info('Pipeline paused for phase review', { runId, phase });
  return { paused: true, runId, phase };
}

function resolveThemeOption(themeOption, overrides = {}) {
  return loadTheme(themeOption || process.env.DEFAULT_THEME, overrides);
}

// ── ASCII BANNER ────────────────────────────
function printBanner(theme) {
  const title = (theme?.bannerTitle || 'SCIFI TRANSFORMATION PIPELINE').toUpperCase();
  const subtitle = theme?.displayName || 'AI Video Generation Factory';
  const tagline = theme?.tagline || '';
  const pad = (s, len) => {
    const clipped = s.length > len ? s.slice(0, len) : s;
    const total = len - clipped.length;
    const left = Math.floor(total / 2);
    const right = total - left;
    return ' '.repeat(left) + clipped + ' '.repeat(right);
  };
  const width = 49;
  console.log(chalk.yellow(`
╔${'═'.repeat(width)}╗
║${pad(`🛸 ${title} 🛸`, width)}║
║${pad(subtitle, width)}║
║${pad('Digital Builders — ashishgupta.dev', width)}║
║${pad('', width)}║
${tagline ? `║${pad(tagline, width)}║\n` : ''}╚${'═'.repeat(width)}╝
  `));
}

// ── MAIN PIPELINE ───────────────────────────
async function runPipeline(options = {}) {
  const theme = resolveThemeOption(options.theme, options.overrides);
  printBanner(theme);
  const startTime = Date.now();
  const runId = options.runId || `run-${Date.now()}`;

  // Per-phase review gate (#113): a continuation job enqueued by
  // admin/server.js's POST /api/phase-review/:runId/approve (after an
  // admin approves a paused phase) passes resumeFromPhase/resumeState so
  // this invocation picks up exactly where the previous one left off,
  // instead of regenerating already-approved (and already-paid-for)
  // phases. resumeFromPhase is the phase NUMBER STILL TO BE GENERATED
  // (1, 2, or 3); a value of 4 means all three are done — skip straight
  // to audio/assembly/publish.
  const resumeFromPhase = options.resumeFromPhase || 1;
  const resumeState = options.resumeState || {};
  const gateEnabled = config.continuity.perPhaseGate.enabled;

  logger.info('Pipeline started', { theme: theme.id, runId, resumeFromPhase, options });
  const usage = resumeState.usage || {};

  try {
    // ── STEP 1: VIDEO GENERATION ────────────
    console.log(chalk.cyan(`\n📹 STEP 1: Generating Video Phases — ${theme.displayName}...\n`));
    const videoGen = new VideoGenerator(theme);
    // Seed any phases already completed (and approved) in a prior
    // invocation, the same way runAssembleOnly() seeds phase1Result/
    // phase2Result for its n8n-driven path — generatePhase2()/
    // generatePhase3() read these off `this`, not from arguments.
    if (resumeState.phase1Result) videoGen.phase1Result = resumeState.phase1Result;
    if (resumeState.phase2Result) videoGen.phase2Result = resumeState.phase2Result;
    if (resumeState.phase3Result) videoGen.phase3Result = resumeState.phase3Result;

    let phase1 = videoGen.phase1Result;
    if (resumeFromPhase <= 1) {
      const spinner1 = ora(`Generating Phase 1 — ${theme.phases.phase1.name || 'Baseline'} (muapi.ai Kling)`).start();
      phase1 = await videoGen.generatePhase1();
      usage.muapiKling = (usage.muapiKling || 0) + 1;
      spinner1.succeed(`Phase 1 complete: ${phase1.url}`);
      await syncRunState(runId, { phase: 1 });

      if (gateEnabled) {
        return await pauseForPhaseReview({
          runId, theme, phase: 1, clipUrl: phase1.url,
          // skipPublish/overrides are carried in state (not just the outer
          // options) because the resume job rebuilds its options entirely
          // from phaseGate.js's persisted entry — admin/server.js's
          // approve route has no other way to know what the original
          // /api/pipeline/start or CLI call actually requested.
          state: { phase1Result: videoGen.phase1Result, usage, skipPublish: options.skipPublish, overrides: options.overrides },
        });
      }
    }

    const phase2Label = config.continuity.tier === 'C' ? 'muapi.ai Aleph' : 'muapi.ai Kling';
    let phase2 = videoGen.phase2Result;
    if (resumeFromPhase <= 2 && theme.phases.phase2) {
      const spinner2 = ora(`Generating Phase 2 — ${theme.phases.phase2.name || 'Transformation'} (${phase2Label})`).start();
      phase2 = await videoGen.generatePhase2();
      if (phase2.provider === 'aleph') {
        usage.aleph = { calls: 1, totalCost: phase2.costUsd || 0 };
      } else {
        usage.muapiKling = (usage.muapiKling || 0) + 1;
      }
      const phase2Note = phase2.fallbackFrom ? ' (fell back from Aleph to Tier B)' : '';
      spinner2.succeed(`Phase 2 complete${phase2Note}: ${phase2.url}`);
      await syncRunState(runId, { phase: 2 });

      if (gateEnabled) {
        return await pauseForPhaseReview({
          runId, theme, phase: 2, clipUrl: phase2.url,
          state: {
            phase1Result: videoGen.phase1Result,
            phase2Result: videoGen.phase2Result,
            usage,
            skipPublish: options.skipPublish,
            overrides: options.overrides,
          },
        });
      }
    }

    let phase3 = videoGen.phase3Result;
    if (resumeFromPhase <= 3 && theme.phases.phase3) {
      const spinner3 = ora(`Generating Phase 3 — ${theme.phases.phase3.name || 'Resolution'} (muapi.ai Kling)`).start();
      phase3 = await videoGen.generatePhase3();
      usage.muapiKling = (usage.muapiKling || 0) + 1;
      spinner3.succeed(`Phase 3 complete: ${phase3.url}`);
      await syncRunState(runId, { phase: 3 });

      if (gateEnabled) {
        return await pauseForPhaseReview({
          runId, theme, phase: 3, clipUrl: phase3.url,
          state: {
            phase1Result: videoGen.phase1Result,
            phase2Result: videoGen.phase2Result,
            phase3Result: videoGen.phase3Result,
            usage,
            skipPublish: options.skipPublish,
            overrides: options.overrides,
          },
        });
      }
    }

    // ── STEP 2: AUDIO GENERATION ────────────
    console.log(chalk.cyan('\n🎵 STEP 2: Generating Audio Layers (Parallel)...\n'));
    const audioGen = new AudioGenerator(theme);

    const spinner4 = ora('Generating all audio layers in parallel...').start();
    const [ambientAudio, transformationAudio, musicScore] = await Promise.all([
      audioGen.generateAmbientAudio(),
      audioGen.generateTransformationAudio(),
      audioGen.generateMusicScore(),
    ]);
    usage.elevenlabs = (usage.elevenlabs || 0) + 2;
    usage.suno = (usage.suno || 0) + 1;
    spinner4.succeed('All audio layers ready');

    // ── STEP 3: ASSEMBLY ────────────────────
    console.log(chalk.cyan('\n⚙️  STEP 3: Assembling Final Video...\n'));
    const assembler = new VideoAssembler(theme);

    const spinner5 = ora('Downloading all assets...').start();
    await assembler.downloadAssets({
      phase1: phase1?.url,
      phase2: phase2?.url,
      phase3: phase3?.url,
      ambientAudio: ambientAudio.url,
      transformationAudio: transformationAudio.url,
      musicScore: musicScore.url,
    });
    spinner5.succeed('All assets downloaded');

    const spinnerSeam = ora('Checking phase seams for color/exposure match...').start();
    await assembler.colorMatchSeams();
    spinnerSeam.succeed('Seam check complete');

    const spinner6 = ora('Mixing audio layers...').start();
    await assembler.mixAudio();
    spinner6.succeed('Audio mix complete');

    const spinner7 = ora('Assembling final video with FFmpeg...').start();
    const masterVideo = await assembler.assembleFinalVideo();
    spinner7.succeed(`Master video ready: ${masterVideo.path}`);
    await syncRunState(runId, { phase: 4 });

    // ── STEP 4: PLATFORM EXPORTS ────────────
    console.log(chalk.cyan('\n📦 STEP 4: Exporting Platform Versions...\n'));

    const spinner8 = ora('Generating all platform versions...').start();
    const exports = await assembler.exportPlatformVersions(masterVideo.path);
    spinner8.succeed(`${Object.keys(exports).length} platform versions ready`);

    // ── STEP 5: PUBLISH (or hold for manual review) ──────────
    // The first config.continuity.reviewQueue.limit Aleph (Tier C) runs
    // are held for manual admin review instead of auto-published, since
    // Aleph's real-world output quality/cost on this account is unproven
    // at go-live. Only a genuine, successful Aleph result triggers the
    // gate — a run that fell back to Tier B (phase2.fallbackFrom set)
    // publishes normally, since it didn't actually use the unproven path.
    let results = {};
    let heldForReview = false;
    const isGenuineAlephRun = phase2.provider === 'aleph' && !phase2.fallbackFrom;
    const reviewGateActive = isGenuineAlephRun &&
      config.continuity.reviewQueue.enabled &&
      (await reviewQueue.isGateActive(config.continuity.reviewQueue.limit));

    if (!options.skipPublish && reviewGateActive) {
      console.log(chalk.cyan('\n🕒 STEP 5: Holding for manual review (Aleph review queue)...\n'));
      await reviewQueue.enqueue({ runId, theme: theme.id, exports });
      heldForReview = true;
      console.log(chalk.yellow(`  ⏸  Run ${runId} held — approve or reject via the admin API (/api/review/pending) before publishing.`));
      // 'held_for_review' matches the status taxonomy documented on the
      // VideoRun model itself (prisma/schema.prisma) — kept distinct from
      // 'completed'/'failed' so the dashboard's ReviewQueue/HumanInTheLoop
      // UI (which polls /api/review/pending, a separate flat-file source of
      // truth) and the Prisma-backed /api/pipeline/status views agree on
      // what's actually happening. admin/server.js's approve/reject routes
      // flip this to 'completed'/'failed' once an admin acts on it.
      await syncRunState(runId, { status: 'held_for_review', phase: 5 });
    } else if (!options.skipPublish) {
      console.log(chalk.cyan('\n🚀 STEP 5: Publishing to All Platforms...\n'));
      const publisher = new Publisher(theme);
      results = await publisher.publishAll(exports);

      console.log(chalk.green('\n✅ PUBLISHED SUCCESSFULLY:\n'));
      Object.entries(results).forEach(([platform, result]) => {
        if (result.success) {
          console.log(chalk.green(`  ✅ ${platform}: ${result.url || 'Published'}`));
        } else {
          console.log(chalk.red(`  ❌ ${platform}: ${result.error}`));
        }
      });
      await syncRunState(runId, { status: 'completed', phase: 5, exports });
    } else {
      // skipPublish: assembly-only run (see runAssembleOnly / CLI --skip-publish).
      // Still a successful pipeline run, just not auto-published.
      await syncRunState(runId, { status: 'completed', phase: 5, exports });
    }

    // ── COST TRACKING ────────────────────────
    await costTracker.recordRun(usage, { theme: theme.id, runId, exports: Object.keys(exports) });

    // ── COMPLETE ────────────────────────────
    const duration = Math.round((Date.now() - startTime) / 1000 / 60);
    console.log(chalk.yellow(`
╔═══════════════════════════════════════════════╗
║              🎉 PIPELINE COMPLETE!            ║
║                                               ║
║  Theme:       ${theme.displayName}
║  Total Time:  ${duration} minutes
║  Master:      output/master_output.mp4        ║
║  Platforms:   ${Object.keys(exports).length} versions exported
║  Status:      ${heldForReview ? 'HELD FOR REVIEW (' + runId + ')' : 'PUBLISHED'}
╚═══════════════════════════════════════════════╝
    `));


  } catch (error) {
    logger.error('Pipeline failed', { error: error.message });
    console.log(chalk.red(`\n❌ Pipeline failed: ${error.message}`));
    await syncRunState(runId, { status: 'failed', error: error.message });

    // Re-throw (rather than the old `process.exitCode = 1` swallow) so the
    // BullMQ worker's catch block (src/queue/worker.js) actually fires —
    // previously this function always resolved successfully even on
    // failure, so worker.js's failure handling and retry logic could never
    // run, and BullMQ marked every failed job 'completed'. The cron
    // scheduler (src/utils/cronManager.js) already wraps its callback in
    // its own try/catch, so this is safe for the `schedule` CLI path too.
    throw error;
  }
}

// ── ASSEMBLE-ONLY (used by n8n: phases generated upstream by HTTP nodes) ──
async function runAssembleOnly(options = {}) {
  const theme = resolveThemeOption(options.theme);
  printBanner(theme);
  logger.info('Assemble-only run started', { theme: theme.id, options });
  // Optional: n8n (or any caller) can pass --run-id to associate this
  // assemble-only pass with a VideoRun row created upstream via
  // POST /api/pipeline/start. Most assemble-only invocations are plain CLI
  // calls with no DB row at all, in which case syncRunState() is a no-op.
  const { runId } = options;

  try {
    const videoGen = new VideoGenerator(theme);
    const audioGen = new AudioGenerator(theme);
    const assembler = new VideoAssembler(theme);

    const phase1Url = options.phase1;
    const phase2Url = options.phase2;
    if (!phase1Url || !phase2Url) {
      throw new Error('--phase1 and --phase2 URLs are required for assemble');
    }

    // generatePhase3() (and Tier B/C continuity logic inside it) reads
    // videoGen.phase1Result/phase2Result rather than raw URL strings —
    // seed both here so this n8n-driven path gets the same last-frame
    // chaining / Aleph-tier handling as runPipeline()'s in-process run.
    // The phase2 tier is assumed to match the configured continuity tier
    // unless the caller overrides it (n8n knows which provider it actually
    // called upstream and can pass --phase2-tier accordingly).
    const phase2Tier = options.phase2Tier || config.continuity.tier;
    videoGen.phase1Result = { url: phase1Url, provider: 'external', tier: phase2Tier };
    videoGen.phase2Result = { url: phase2Url, provider: 'external', tier: phase2Tier };

    console.log(chalk.cyan('\n📹 Fetching Phase 3 + remaining audio...\n'));
    const phase3 = await videoGen.generatePhase3();
    await syncRunState(runId, { phase: 3 });
    const musicScore = await audioGen.generateMusicScore();

    await assembler.downloadAssets({
      phase1: phase1Url,
      phase2: phase2Url,
      phase3: phase3.url,
      ambientAudio: options.ambientAudio ? `file://${options.ambientAudio}` : undefined,
      transformationAudio: options.transformationAudio ? `file://${options.transformationAudio}` : undefined,
      musicScore: musicScore.url,
    });

    await assembler.colorMatchSeams();
    await assembler.mixAudio();
    const masterVideo = await assembler.assembleFinalVideo();
    const exports = await assembler.exportPlatformVersions(masterVideo.path);

    console.log(chalk.green(`\n✅ Assembly complete: ${masterVideo.path}`));
    logger.info('Assemble-only run complete', { exports: Object.keys(exports) });
    await syncRunState(runId, { status: 'completed', phase: 4, exports });

  } catch (error) {
    logger.error('Assemble-only run failed', { error: error.message });
    console.log(chalk.red(`\n❌ Assembly failed: ${error.message}`));
    await syncRunState(runId, { status: 'failed', error: error.message });

    process.exitCode = 1;
  }
}

// ── CLI SETUP ───────────────────────────────
program
  .name('scifi-pipeline')
  .description('Generic SciFi Transformation Video Pipeline — any deity, location, product, or business via --theme')
  .version('2.0.0');

program
  .command('generate')
  .description('Run full video generation pipeline')
  .option('--theme <name>', 'Theme to use (see list-themes); falls back to DEFAULT_THEME env var')
  .option('--skip-publish', 'Generate videos but skip publishing')
  .option('--phase <number>', 'Run only specific phase (1, 2, or 3)')
  .option('--base-image <url>', 'Override the theme\'s baseImageUrl for this run (your own input image)')
  .option('--target-image <url>', 'Reference/target image for Tier C Aleph transform (what Phase 2 should transform toward)')
  .option('--phase1-image <url>', 'Override Phase 1\'s source image for this run')
  .option('--phase2-image <url>', 'Override Phase 2\'s source image for this run')
  .option('--phase3-image <url>', 'Override Phase 3\'s source image for this run')
  .option('--phase2-video-input <url>', 'Tier C only: source video fed into Aleph instead of Phase 1\'s real rendered output')
  .option('--phase2-reference-image <url>', 'Tier C only: reference image for Aleph, overrides --target-image for Phase 2 specifically')
  .action(async (opts) => {
    const runId = `cli-run-${Date.now()}`;
    if (config.continuity.perPhaseGate.enabled) {
      console.log(chalk.yellow('\n⏸  Per-phase review gate is ON (ENABLE_PER_PHASE_GATE=true) — this run will pause after each phase. Approve via the admin API (/api/phase-review/pending) or dashboard to continue.\n'));
    }
    await enqueueVideoRun({
      runId,
      theme: opts.theme,
      skipPublish: opts.skipPublish,
      overrides: {
        baseImageUrl: opts.baseImage,
        targetImageUrl: opts.targetImage,
        phase1ImageUrl: opts.phase1Image,
        phase2ImageUrl: opts.phase2Image,
        phase3ImageUrl: opts.phase3Image,
        phase2VideoInputUrl: opts.phase2VideoInput,
        phase2ReferenceImageUrl: opts.phase2ReferenceImage,
      },
    });
    console.log(chalk.green(`\n✅ Job enqueued successfully with runId: ${runId}\n`));
    console.log(chalk.cyan(`Make sure the worker is running to process the job: \`node src/queue/worker.js\`\n`));
    process.exit(0);
  });

program
  .command('assemble')
  .description('Assemble final video from already-generated phase URLs (used by n8n)')
  .option('--theme <name>', 'Theme to use (see list-themes); falls back to DEFAULT_THEME env var')
  .requiredOption('--phase1 <url>', 'Phase 1 video URL')
  .requiredOption('--phase2 <url>', 'Phase 2 video URL')
  .option('--phase2-tier <tier>', 'Which tier actually produced --phase2 upstream (A|B|C); defaults to CONTINUITY_TIER env var')
  .option('--ambient-audio <path>', 'Local path to a pre-generated ambient/baseline audio file')
  .option('--transformation-audio <path>', 'Local path to a pre-generated transformation audio file')
  .option('--run-id <id>', 'VideoRun id to sync status/phase into (only if it was created upstream via POST /api/pipeline/start)')
  .action((opts) => runAssembleOnly({
    theme: opts.theme,
    phase1: opts.phase1,
    phase2: opts.phase2,
    phase2Tier: opts.phase2Tier,
    ambientAudio: opts.ambientAudio,
    transformationAudio: opts.transformationAudio,
    runId: opts.runId,
  }));

program
  .command('publish')
  .description('Publish pre-generated videos to all platforms')
  .option('--theme <name>', 'Theme to use (see list-themes); falls back to DEFAULT_THEME env var')
  .option('--all', 'Publish all platform exports found in output/')
  .action(async (opts) => {
    const theme = resolveThemeOption(opts.theme);
    const publisher = new Publisher(theme);
    await publisher.publishFromOutput();
  });

program
  .command('list-themes')
  .description('List all available themes (themes/*.json)')
  .action(() => {
    const themes = listThemes();
    if (!themes.length) {
      console.log(chalk.red('No themes found in themes/. Copy themes/_template.json to get started.'));
      return;
    }
    console.log(chalk.cyan('\nAvailable themes:\n'));
    themes.forEach((id) => {
      try {
        const theme = loadTheme(id);
        console.log(`  ${chalk.green(id)} — ${theme.displayName} (${theme.subjectType || 'general'})`);
      } catch (error) {
        console.log(`  ${chalk.red(id)} — invalid: ${error.message}`);
      }
    });
    console.log();
  });

program
  .command('test-apis')
  .description('Test all API connections')
  .action(async () => {
    const { testAllAPIs } = require('../scripts/test-apis');
    await testAllAPIs();
  });

program
  .command('cost-report')
  .description('Show estimated spend across all pipeline runs')
  .action(async () => {
    const summary = await costTracker.getSummary();
    console.log(chalk.cyan('\n💰 COST REPORT\n'));
    console.log(`Total runs:        ${summary.totalRuns}`);
    console.log(`Runs this month:   ${summary.monthRuns}`);
    console.log(`Spend this month:  $${summary.monthTotalUsd}`);
    console.log(`Spend all-time:    $${summary.allTimeTotalUsd}`);
    console.log(`Nearest tier:      ${summary.nearestBudgetTier.name} ($${summary.nearestBudgetTier.monthlyUsd}/mo, ${summary.nearestBudgetTier.videosPerMonth} videos)`);
  });

program
  .command('schedule')
  .description('Run pipeline on a recurring cron schedule (local fallback to n8n)')
  .option('--theme <name>', 'Theme to use (see list-themes); falls back to DEFAULT_THEME env var')
  .option('--cron <expression>', 'Cron expression', '0 2 * * 1')
  .action((opts) => {
    console.log(chalk.cyan(`\n⏰ Scheduling pipeline runs: ${opts.cron} (Asia/Kolkata)\n`));
    cronManager.schedule('main-pipeline', opts.cron, () => runPipeline({ theme: opts.theme }));
    console.log(chalk.green('Scheduler running. Press Ctrl+C to stop.'));
  });

// Only drive the Commander CLI (and the "no command = run generate" default)
// when this file is executed directly as `node src/index.js ...`. Other
// modules — notably admin/server.js — require() this file purely to reuse
// runPipeline()/runAssembleOnly(), and must not have their own process.argv
// interpreted as CLI input (that previously caused Commander to print help
// and exit(1) as soon as the admin server started).
if (require.main === module) {
  program.parse(process.argv);

  // Default: run generate if no command
  if (process.argv.length === 2) {
    console.log(chalk.yellow("Running default generate command..."));
    enqueueVideoRun({ runId: `cli-run-${Date.now()}` }).then(() => {
      console.log(chalk.green("Job enqueued successfully. Make sure the worker is running."));
      process.exit(0);
    });
  }
}

module.exports = { runPipeline, runAssembleOnly };
