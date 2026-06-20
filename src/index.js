// src/index.js
// Main entry point — Jagannatha SciFi Pipeline

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
const whatsapp = require('./notify/whatsapp');

const program = new Command();

// ── ASCII BANNER ────────────────────────────
function printBanner() {
  console.log(chalk.yellow(`
╔═══════════════════════════════════════════════╗
║     🛸 JAGANNATHA SCIFI PIPELINE v1.0 🛸      ║
║     Sacred Meets Sci-Fi Video Factory         ║
║     Digital Builders — ashishgupta.dev        ║
║                                               ║
║          जय जगन्नाथ! JAI JAGANNATH! 🙏        ║
╚═══════════════════════════════════════════════╝
  `));
}

// ── MAIN PIPELINE ───────────────────────────
async function runPipeline(options = {}) {
  printBanner();
  const startTime = Date.now();

  logger.info('Pipeline started', { options });
  const usage = {};

  try {
    // ── STEP 1: VIDEO GENERATION ────────────
    console.log(chalk.cyan('\n📹 STEP 1: Generating Video Phases...\n'));
    const videoGen = new VideoGenerator();

    const spinner1 = ora('Generating Phase 1 — Sacred Baseline (Runway)').start();
    const phase1 = await videoGen.generatePhase1();
    usage.runway = (usage.runway || 0) + 1;
    spinner1.succeed(`Phase 1 complete: ${phase1.url}`);

    const spinner2 = ora('Generating Phase 2 — SciFi Transformation (Kling AI)').start();
    const phase2 = await videoGen.generatePhase2(phase1.url);
    usage.kling = (usage.kling || 0) + 1;
    spinner2.succeed(`Phase 2 complete: ${phase2.url}`);

    const spinner3 = ora('Generating Phase 3 — Sacred Return (Pika)').start();
    const phase3 = await videoGen.generatePhase3();
    usage.pika = (usage.pika || 0) + 1;
    spinner3.succeed(`Phase 3 complete: ${phase3.url}`);

    // ── STEP 2: AUDIO GENERATION ────────────
    console.log(chalk.cyan('\n🎵 STEP 2: Generating Audio Layers (Parallel)...\n'));
    const audioGen = new AudioGenerator();

    const spinner4 = ora('Generating all audio layers in parallel...').start();
    const [sacredAudio, scifiAudio, musicScore] = await Promise.all([
      audioGen.generateSacredAudio(),
      audioGen.generateSciFiAudio(),
      audioGen.generateMusicScore(),
    ]);
    usage.elevenlabs = (usage.elevenlabs || 0) + 2;
    usage.suno = (usage.suno || 0) + 1;
    spinner4.succeed('All audio layers ready');

    // ── STEP 3: ASSEMBLY ────────────────────
    console.log(chalk.cyan('\n⚙️  STEP 3: Assembling Final Video...\n'));
    const assembler = new VideoAssembler();

    const spinner5 = ora('Downloading all assets...').start();
    await assembler.downloadAssets({
      phase1: phase1.url,
      phase2: phase2.url,
      phase3: phase3.url,
      sacredAudio: sacredAudio.url,
      scifiAudio: scifiAudio.url,
      musicScore: musicScore.url,
    });
    spinner5.succeed('All assets downloaded');

    const spinner6 = ora('Mixing audio layers...').start();
    await assembler.mixAudio();
    spinner6.succeed('Audio mix complete');

    const spinner7 = ora('Assembling final video with FFmpeg...').start();
    const masterVideo = await assembler.assembleFinalVideo();
    spinner7.succeed(`Master video ready: ${masterVideo.path}`);

    // ── STEP 4: PLATFORM EXPORTS ────────────
    console.log(chalk.cyan('\n📦 STEP 4: Exporting Platform Versions...\n'));

    const spinner8 = ora('Generating all platform versions...').start();
    const exports = await assembler.exportPlatformVersions(masterVideo.path);
    spinner8.succeed(`${Object.keys(exports).length} platform versions ready`);

    // ── STEP 5: PUBLISH ─────────────────────
    let results = {};
    if (!options.skipPublish) {
      console.log(chalk.cyan('\n🚀 STEP 5: Publishing to All Platforms...\n'));
      const publisher = new Publisher();
      results = await publisher.publishAll(exports);

      console.log(chalk.green('\n✅ PUBLISHED SUCCESSFULLY:\n'));
      Object.entries(results).forEach(([platform, result]) => {
        if (result.success) {
          console.log(chalk.green(`  ✅ ${platform}: ${result.url || 'Published'}`));
        } else {
          console.log(chalk.red(`  ❌ ${platform}: ${result.error}`));
        }
      });
    }

    // ── COST TRACKING ────────────────────────
    await costTracker.recordRun(usage, { exports: Object.keys(exports) });

    // ── COMPLETE ────────────────────────────
    const duration = Math.round((Date.now() - startTime) / 1000 / 60);
    console.log(chalk.yellow(`
╔═══════════════════════════════════════════════╗
║              🎉 PIPELINE COMPLETE!            ║
║                                               ║
║  Total Time:  ${duration} minutes
║  Master:      output/master_output.mp4        ║
║  Platforms:   ${Object.keys(exports).length} versions exported
║                                               ║
║          JAI JAGANNATH! 🙏🪔🎆               ║
╚═══════════════════════════════════════════════╝
    `));

    await whatsapp.notifyCompletion({ duration, exports });

  } catch (error) {
    logger.error('Pipeline failed', { error: error.message });
    console.log(chalk.red(`\n❌ Pipeline failed: ${error.message}`));
    await whatsapp.notifyError({ stage: 'generate', error: error.message });
    process.exitCode = 1;
  }
}

// ── ASSEMBLE-ONLY (used by n8n: phases generated upstream by HTTP nodes) ──
async function runAssembleOnly(options = {}) {
  printBanner();
  logger.info('Assemble-only run started', { options });

  try {
    const videoGen = new VideoGenerator();
    const audioGen = new AudioGenerator();
    const assembler = new VideoAssembler();

    const phase1Url = options.phase1;
    const phase2Url = options.phase2;
    if (!phase1Url || !phase2Url) {
      throw new Error('--phase1 and --phase2 URLs are required for assemble');
    }

    console.log(chalk.cyan('\n📹 Fetching Phase 3 + remaining audio...\n'));
    const phase3 = await videoGen.generatePhase3();
    const musicScore = await audioGen.generateMusicScore();

    const assembler2 = assembler;
    await assembler2.downloadAssets({
      phase1: phase1Url,
      phase2: phase2Url,
      phase3: phase3.url,
      sacredAudio: options.sacredAudio ? `file://${options.sacredAudio}` : undefined,
      scifiAudio: options.scifiAudio ? `file://${options.scifiAudio}` : undefined,
      musicScore: musicScore.url,
    });

    await assembler2.mixAudio();
    const masterVideo = await assembler2.assembleFinalVideo();
    const exports = await assembler2.exportPlatformVersions(masterVideo.path);

    console.log(chalk.green(`\n✅ Assembly complete: ${masterVideo.path}`));
    logger.info('Assemble-only run complete', { exports: Object.keys(exports) });

  } catch (error) {
    logger.error('Assemble-only run failed', { error: error.message });
    console.log(chalk.red(`\n❌ Assembly failed: ${error.message}`));
    await whatsapp.notifyError({ stage: 'assemble', error: error.message });
    process.exitCode = 1;
  }
}

// ── CLI SETUP ───────────────────────────────
program
  .name('jagannatha-pipeline')
  .description('Sacred SciFi Video Generation Pipeline')
  .version('1.0.0');

program
  .command('generate')
  .description('Run full video generation pipeline')
  .option('--skip-publish', 'Generate videos but skip publishing')
  .option('--phase <number>', 'Run only specific phase (1, 2, or 3)')
  .action(runPipeline);

program
  .command('assemble')
  .description('Assemble final video from already-generated phase URLs (used by n8n)')
  .requiredOption('--phase1 <url>', 'Phase 1 video URL')
  .requiredOption('--phase2 <url>', 'Phase 2 video URL')
  .option('--sacred-audio <path>', 'Local path to sacred audio file')
  .option('--scifi-audio <path>', 'Local path to sci-fi audio file')
  .action((opts) => runAssembleOnly({
    phase1: opts.phase1,
    phase2: opts.phase2,
    sacredAudio: opts.sacredAudio,
    scifiAudio: opts.scifiAudio,
  }));

program
  .command('publish')
  .description('Publish pre-generated videos to all platforms')
  .option('--all', 'Publish all platform exports found in output/')
  .action(async () => {
    const publisher = new Publisher();
    await publisher.publishFromOutput();
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
  .option('--cron <expression>', 'Cron expression', '0 2 * * 1')
  .action((opts) => {
    console.log(chalk.cyan(`\n⏰ Scheduling pipeline runs: ${opts.cron} (Asia/Kolkata)\n`));
    cronManager.schedule('main-pipeline', opts.cron, () => runPipeline({}));
    console.log(chalk.green('Scheduler running. Press Ctrl+C to stop.'));
  });

program.parse(process.argv);

// Default: run generate if no command
if (process.argv.length === 2) {
  runPipeline({});
}

module.exports = { runPipeline, runAssembleOnly };
