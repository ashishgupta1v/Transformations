// src/video/generator.js
// Handles all video generation via muapi.ai (Kling image-to-video, all
// themes, and Runway Gen-4 Aleph video-to-video for Tier C continuity)
// plus an optional Replicate call for the 4K upscale (opt-in) feature.
// Subject-specific content (prompts, base image, duration, optional
// reference/target images) comes from a theme object (see themes/*.json +
// src/utils/themeLoader.js). Engine-level tuning (polling/retry/upscale/
// continuity) stays in config/pipeline.config.js and is shared across all
// themes.
//
// CONTINUITY TIERS (config.continuity.tier, env CONTINUITY_TIER):
//   A — each phase is an independent muapi.ai Kling image-to-video call
//       from a reference still (the pure-budget baseline: ~$0.225/phase
//       on a 5s clip, weakest continuity between phases).
//   B — free ffmpeg last-frame extraction chains phase N's actual last
//       frame into phase N+1's starting image. $0 extra cost, moderate
//       continuity (still independent generations, but visually anchored).
//   C — "Option B" architecture (the current default): Phase 1 = Kling
//       image-to-video (5s) from baseImageUrl. Phase 2 = Runway Gen-4
//       Aleph video-to-video (flat $0.90/call, any length), transforming
//       Phase 1's ACTUAL rendered clip in place (not just a still) — true
//       continuity. Phase 2→3 = free ffmpeg last-frame extraction (same
//       mechanism as Tier B). Phase 3 = Kling image-to-video (5s)
//       continuing from that real frame. Total: 15s, matching
//       config.assembly.totalDuration.
//       If Aleph fails (after its own retry budget) or the monthly budget
//       circuit breaker trips, automatically falls back to Tier B for
//       that run when config.continuity.fallbackEnabled is true.
//
// 2026-06 muapi.ai migration: Kling i2v moved here from fal.ai, and
// Runway Aleph v2v moved here from Replicate. Both schemas were CONFIRMED
// against muapi.ai's public, no-auth-required discovery endpoints
// (GET /api/v1/models/{name} for input_schema, POST .../estimate-cost for
// required-field validation) — see DEPLOYMENT_NOTES.md for the full
// confirmation trail. Key schema facts that shaped the code below:
//   kling-v2.1-standard-i2v: required prompt + image_url; optional
//     aspect_ratio (16:9 | 9:16 | 1:1, default 16:9) and duration (5 or
//     10 only, step 5, default 5). NO negative_prompt field — themes'
//     phases.*.negativePrompt is intentionally not sent to muapi.
//   runway-aleph-v2v: required prompt + video_url; optional aspect_ratio.
//     NO duration field (billed as a flat $0.90/call) and NO
//     reference_image/seed fields — the old Replicate best-guess schema
//     included both, neither exists on muapi's confirmed schema.
// fal.ai is no longer used anywhere in this file — it remains in the
// codebase only for ElevenLabs-based voice/SFX (see src/audio/generator.js),
// which calls ElevenLabs' own API directly, not via fal.ai at all.

const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const logger = require('../utils/logger');
const config = require('../../config/pipeline.config');
const { withRetry, sleep } = require('../utils/retry');
const ffmpegHelpers = require('../utils/ffmpegHelpers');
const costTracker = require('../utils/costTracker');

const MUAPI_BASE_URL = process.env.MUAPI_BASE_URL || 'https://api.muapi.ai/api/v1';

class VideoGenerator {
  constructor(theme) {
    this.theme = theme || null;
    this.tempDir = process.env.TEMP_DIR || './temp';
    fs.ensureDirSync(this.tempDir);
    // Populated as each phase completes, within a single run, so later
    // phases can chain from earlier phases' actual rendered output
    // (Tier B/C continuity). index.js reuses one VideoGenerator instance
    // across all 3 phase calls, so this is safe statefully.
    this.phase1Result = null;
    this.phase2Result = null;
    this.phase3Result = null;
  }

  requireTheme() {
    if (!this.theme) {
      throw new Error('VideoGenerator requires a theme — pass one to the constructor (see themes/)');
    }
    return this.theme;
  }

  muapiHeaders() {
    if (!process.env.MUAPI_API_KEY) {
      throw new Error('MUAPI_API_KEY not set — required for all video generation phases');
    }
    return {
      'x-api-key': process.env.MUAPI_API_KEY,
      'Content-Type': 'application/json',
    };
  }

  // ── GENERIC PHASE RUNNER (muapi.ai Kling image-to-video) ─────────
  // Every Kling-based phase is an independent image-to-video call: a
  // reference still image + that phase's prompt/duration. The image
  // defaults to theme.baseImageUrl, but can be overridden by (in priority
  // order): opts.imageOverride (used by Tier B/C chaining, and by future
  // per-run user-supplied images), then phases.<phaseKey>.imageUrl (a
  // theme-authored override), then theme.baseImageUrl.
  // NOTE: negativePrompt (if present on the theme) is intentionally
  // dropped here — muapi's kling-v2.1-standard-i2v schema has no
  // negative_prompt field. Duration must be 5 or 10 (Kling's only allowed
  // values); any other theme-authored duration is clamped to the nearest
  // allowed value to avoid a hard API rejection.
  async generatePhaseFromTheme(phaseKey, label, opts = {}) {
    const klingModel = config.continuity.klingModel;
    logger.info(`Starting ${label} — muapi.ai (${klingModel})`);
    const theme = this.requireTheme();
    const phase = theme.phases[phaseKey];
    if (!phase) {
      throw new Error(`Theme "${theme.id}" has no phases.${phaseKey} defined`);
    }
    const { prompt, duration, imageUrl, targetImageUrl } = phase;
    const referenceImage = opts.imageOverride || imageUrl || theme.baseImageUrl;
    if (!referenceImage) {
      throw new Error(`No image available for ${phaseKey} — set theme.baseImageUrl or phases.${phaseKey}.imageUrl`);
    }
    const allowedDuration = Number(duration) >= 8 ? 10 : 5;

    try {
      const payload = {
        prompt,
        image_url: referenceImage,
        duration: allowedDuration,
        aspect_ratio: theme.aspectRatio || config.continuity.aspectRatio || '9:16',
        webhook_url: opts.webhookUrl,
      };

      if (targetImageUrl) {
        payload.last_image = targetImageUrl;
      }

      const predictionId = await withRetry(
        () => this.submitMuapi(klingModel, payload),
        { label: `muapi.ai submit (${label})` }
      );

      logger.info('muapi.ai task submitted', { predictionId, label });

      if (opts.webhookUrl) {
        logger.info(`${label} task queued via webhook`, { predictionId });
        return { taskId: predictionId, provider: 'muapiKling', status: 'queued' };
      }

      const result = await this.pollMuapi(predictionId);
      logger.info(`${label} complete`, { url: result.url });

      if (phase.reverseVideo) {
        logger.info(`Reversing video for ${label}...`);
        const os = require('os');
        const storage = require('../utils/storage');
        const tempDir = path.join(os.tmpdir(), 'scifi-transform', 'reverse');
        await fs.ensureDir(tempDir);
        
        const inputPath = path.join(tempDir, `${predictionId}_fwd.mp4`);
        const outputPath = path.join(tempDir, `${predictionId}_rev.mp4`);

        const writer = fs.createWriteStream(inputPath);
        const downloadResponse = await axios({
          url: result.url,
          method: 'GET',
          responseType: 'stream'
        });
        downloadResponse.data.pipe(writer);
        await new Promise((resolve, reject) => {
          writer.on('finish', resolve);
          writer.on('error', reject);
        });

        await ffmpegHelpers.reverseVideo(inputPath, outputPath);

        const uploadResult = await storage.uploadFile(outputPath, 'reversed');
        logger.info(`${label} reversed and uploaded`, { url: uploadResult.url });
        
        result.url = uploadResult.url;
        
        await fs.remove(inputPath).catch(() => {});
        await fs.remove(outputPath).catch(() => {});
      }

      return { ...result, taskId: predictionId };

    } catch (error) {
      logger.error(`${label} failed`, { error: error.message });
      throw new Error(`${label} generation failed: ${error.message}`);
    }
  }

  // ── PHASE 1 — always Kling image-to-video from baseImageUrl ─────
  async generatePhase1() {
    const result = await this.generatePhaseFromTheme('phase1', 'Phase 1');
    const costUsd = this.klingCostFor('phase1');
    this.phase1Result = { ...result, provider: 'muapiKling', tier: config.continuity.tier, costUsd };
    return this.phase1Result;
  }

  // ── PHASE 2 — tier-aware ─────────────────
  async generatePhase2() {
    const theme = this.requireTheme();
    if (theme.phases.phase2?.reverseVideo) {
      logger.info('Phase 2 is configured for Reverse Generation. Bypassing tier logic.');
      const result = await this.generatePhaseFromTheme('phase2', 'Phase 2');
      this.phase2Result = { ...result, provider: 'muapiKling', tier: 'Reverse', costUsd: this.klingCostFor('phase2') };
      return this.phase2Result;
    }

    const tier = config.continuity.tier;

    if (tier === 'C' && theme.phases.phase2?.targetImageUrl) {
      logger.info('Phase 2 has targetImageUrl. Bypassing Aleph (Tier C) to use Kling Image-to-Video with image_tail.');
      const result = await this.generatePhase2TierB();
      this.phase2Result = result;
      return result;
    }

    if (tier === 'C') {
      try {
        const result = await this.transformPhase2WithAleph(this.phase1Result?.url);
        this.phase2Result = result;
        return result;
      } catch (error) {
        if (!config.continuity.fallbackEnabled) {
          throw error;
        }
        logger.warn('Aleph Phase 2 (Tier C) failed, falling back to Tier B (free last-frame chain)', {
          error: error.message,
        });
        const result = await this.generatePhase2TierB();
        this.phase2Result = { ...result, fallbackFrom: 'aleph', fallbackReason: error.message };
        return this.phase2Result;
      }
    }

    if (tier === 'B') {
      const result = await this.generatePhase2TierB();
      this.phase2Result = result;
      return result;
    }

    // Tier A — independent generation, unchanged 2026-06 baseline behavior
    const result = await this.generatePhaseFromTheme('phase2', 'Phase 2');
    this.phase2Result = { ...result, provider: 'muapiKling', tier: 'A', costUsd: this.klingCostFor('phase2') };
    return this.phase2Result;
  }

  // Tier B: chain Phase 1's actual last frame into Phase 2's starting image
  // via free ffmpeg extraction, then run an otherwise-normal Kling call.
  async generatePhase2TierB() {
    if (!this.phase1Result?.url) {
      throw new Error('Tier B Phase 2 requires a completed phase1Result — call generatePhase1() first');
    }
    const theme = this.requireTheme();
    let imageOverride = null;
    
    // Only chain from the previous video if the user didn't explicitly upload a custom base image
    if (!theme.phases.phase2?.imageUrl) {
      imageOverride = await this.extractLastFrameDataUri(this.phase1Result.url, 'Phase2_chain');
    }
    
    const result = await this.generatePhaseFromTheme('phase2', 'Phase 2', { imageOverride });
    return { ...result, provider: 'muapiKling', tier: 'B', costUsd: this.klingCostFor('phase2') };
  }

  // ── PHASE 3 — chains from Phase 2's real last frame for Tier B/C ────
  // Tier A keeps the old fully-independent baseline (no chaining), to
  // preserve that tier's original cost/behavior profile exactly.
  async generatePhase3() {
    const theme = this.requireTheme();
    let imageOverride = null;
    
    // Only chain from the previous video if Tier B/C and the user didn't explicitly upload a custom base image
    const tier = config.continuity.tier;
    if (tier !== 'A' && !theme.phases.phase3?.imageUrl) {
      if (!this.phase2Result?.url) {
        throw new Error('Phase 3 requires a completed phase2Result');
      }
      imageOverride = await this.extractLastFrameDataUri(this.phase2Result.url, 'Phase3_chain');
    }

    const result = await this.generatePhaseFromTheme('phase3', 'Phase 3', { imageOverride });
    const costUsd = this.klingCostFor('phase3');
    this.phase3Result = { ...result, provider: 'muapiKling', tier: config.continuity.tier, costUsd };
    return this.phase3Result;
  }

  // Per-phase Kling cost estimate, scaled off the confirmed $0.045/s rate
  // (costEstimates.muapiKling is expressed as a $/5s-clip baseline) rather
  // than a single flat blended number — a phase authored at 10s should
  // cost roughly double a 5s phase, not the same flat estimate.
  klingCostFor(phaseKey) {
    const theme = this.requireTheme();
    const duration = Number(theme.phases[phaseKey]?.duration) || 5;
    const allowedDuration = duration >= 8 ? 10 : 5;
    return Number((config.costEstimates.muapiKling * (allowedDuration / 5)).toFixed(4));
  }

  // ── TIER C: PHASE 2 VIA RUNWAY GEN-4 ALEPH (muapi.ai) ──────────
  // True video-to-video: transforms Phase 1's actual rendered clip
  // in place, instead of generating a fresh independent clip from a
  // still image. This is the most expensive single call in the pipeline
  // (flat $0.90/call, confirmed against muapi.ai's live schema/cost-estimate
  // endpoints — see DEPLOYMENT_NOTES.md) and the least proven on this
  // account, hence the budget circuit breaker check and (separately, see
  // index.js) the manual review queue gating the first batch of runs.
  async transformPhase2WithAleph(phase1VideoUrl) {
    const theme = this.requireTheme();
    const phase = theme.phases.phase2;
    const alephModel = config.continuity.alephModel;

    if (!phase1VideoUrl) {
      throw new Error('Tier C Phase 2 (Aleph) requires phase1Result.url — call generatePhase1() first');
    }

    // Budget circuit breaker: hard-stop before submitting if this call
    // would push month-to-date spend over circuitBreaker.budgetCapUsd.
    const estimatedCost = config.costEstimates.alephPerCall;
    const budgetCheck = await costTracker.checkBudgetCircuitBreaker(estimatedCost);
    if (!budgetCheck.allowed) {
      throw new Error(
        `Budget circuit breaker tripped: this Aleph call (~$${estimatedCost.toFixed(2)}) would push ` +
        `month-to-date spend from $${budgetCheck.monthSpend} to $${budgetCheck.projected}, over the ` +
        `$${budgetCheck.cap} cap (MONTHLY_BUDGET_CAP_USD). Raise the cap or wait for next month.`
      );
    }

    // Source video: an explicit per-theme override (phases.phase2.videoInputUrl)
    // takes priority; otherwise use Phase 1's actual rendered output — the
    // entire point of Tier C is editing real frames, not a fresh generation.
    const sourceVideoUrl = phase.videoInputUrl || phase1VideoUrl;

    logger.info(`Starting Phase 2 — muapi.ai Aleph video-to-video (${alephModel})`, {
      sourceVideoUrl,
      estimatedCostUsd: estimatedCost,
    });

    // Confirmed schema (2026-06): only prompt + video_url are required;
    // aspect_ratio is the only optional field (no reference_image/seed —
    // those were best-guess Replicate-era field names that don't exist
    // on muapi's actual schema).
    const input = {
      prompt: phase.prompt,
      video_url: sourceVideoUrl,
      aspect_ratio: theme.aspectRatio || config.continuity.aspectRatio || '9:16',
      webhook_url: theme.webhookUrl, // passed via theme object or globally
    };

    const predictionId = await withRetry(
      () => this.submitMuapi(alephModel, input),
      {
        label: 'muapi.ai submit (Aleph Phase 2)',
        maxAttempts: config.retryAleph.maxAttempts,
        delayMs: config.retryAleph.delayMs,
        backoffMultiplier: config.retryAleph.backoffMultiplier,
      }
    );

    logger.info('Aleph prediction submitted', { predictionId });

    if (theme.webhookUrl) {
       return { taskId: predictionId, provider: 'aleph', tier: 'C', status: 'queued' };
    }

    const result = await this.pollMuapi(predictionId, config.pollingAleph);
    const costUsd = Number(estimatedCost.toFixed(4));
    logger.info('Phase 2 (Aleph, Tier C) complete', { url: result.url, costUsd });

    return { ...result, taskId: predictionId, provider: 'aleph', tier: 'C', costUsd };
  }

  // ── LAST-FRAME EXTRACTION (free, used by Tier B & C) ────────────
  // Downloads a remote rendered clip to a temp file, extracts its last
  // frame via ffmpeg, returns it as a base64 data URI (so it can be fed
  // straight into the next muapi.ai call's image_url field without needing
  // separate hosting), then cleans up the temp files.
  async extractLastFrameDataUri(videoUrl, label) {
    const safeLabel = label.replace(/[^a-zA-Z0-9_-]/g, '_');
    const stamp = Date.now();
    const videoPath = path.join(this.tempDir, `${safeLabel}_source_${stamp}.mp4`);
    const framePath = path.join(this.tempDir, `${safeLabel}_lastframe_${stamp}.png`);

    try {
      await this.downloadRemoteFile(videoUrl, videoPath);
      await ffmpegHelpers.extractLastFrame(videoPath, framePath);
      
      // Upload frame to Oracle Object Storage (or fallback) to get a real HTTP URL
      // muapi.ai Kling API rejects base64 data URIs
      const storage = require('../utils/storage');
      const uploadResult = await storage.uploadFile(framePath, 'continuity_frames');
      logger.debug('Extracted and uploaded last-frame for continuity chain', { label, videoUrl, frameUrl: uploadResult.url });
      
      return uploadResult.url;
    } finally {
      await fs.remove(videoPath).catch(() => {});
      await fs.remove(framePath).catch(() => {});
    }
  }

  async downloadRemoteFile(url, destPath) {
    await fs.ensureDir(path.dirname(destPath));
    if (url.startsWith('file://')) {
      await fs.copy(url.replace('file://', ''), destPath);
      return destPath;
    }
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    await fs.writeFile(destPath, response.data);
    return destPath;
  }

  // ── OPTIONAL: 4K UPSCALE (REPLICATE) ────
  // Engine-level — not theme-dependent. Replicate is retained in this
  // codebase ONLY for this optional upscale pass; Kling and Aleph both
  // moved to muapi.ai (see file header).
  async upscaleVideo(videoUrl) {
    if (!config.upscale.enabled) {
      logger.debug('Upscale disabled, skipping');
      return { url: videoUrl, upscaled: false };
    }

    logger.info('Starting 4K upscale via Replicate', { model: config.upscale.model });

    try {
      const predictionId = await withRetry(
        () => this.submitReplicateModel(config.upscale.model, {
          image: videoUrl,
          scale: config.upscale.scale,
        }),
        { label: 'Replicate submit (upscale)' }
      );

      const result = await this.pollReplicate(predictionId);
      logger.info('Upscale complete', { url: result.url });
      return { ...result, upscaled: true };

    } catch (error) {
      logger.warn('Upscale failed, falling back to original video', { error: error.message });
      return { url: videoUrl, upscaled: false, error: error.message };
    }
  }

  // ── MUAPI.AI: SUBMIT ──────────────────────
  // muapi's REST API takes the model's input fields directly as the POST
  // body (no wrapper) against /api/v1/{model-name}, and returns a
  // prediction id used for polling — confirmed via muapi.ai/docs and the
  // muapi-cli reference implementation (github.com/SamurAIGPT/muapi-cli).
  async submitMuapi(modelName, input) {
    const cleanInput = Object.fromEntries(
      Object.entries(input).filter(([, v]) => v !== undefined && v !== null)
    );

    const response = await axios.post(
      `${MUAPI_BASE_URL}/${modelName}`,
      cleanInput,
      { headers: this.muapiHeaders() }
    );

    const predictionId = response.data?.request_id || response.data?.id;
    if (!predictionId) {
      throw new Error(`muapi.ai submit to "${modelName}" returned no prediction/request id`);
    }
    return predictionId;
  }

  // ── MUAPI.AI: POLL ─────────────────────────
  // GET /api/v1/predictions/{id}/result until status is "completed" or
  // "failed". Successful payloads include an `outputs` array of URLs.
  async pollMuapi(predictionId, pollingOverride) {
    const { intervalMs, maxAttempts } = pollingOverride || config.polling;
    let attempts = 0;

    while (attempts < maxAttempts) {
      await sleep(intervalMs);
      attempts++;

      const response = await axios.get(
        `${MUAPI_BASE_URL}/predictions/${predictionId}/result`,
        { headers: this.muapiHeaders() }
      );

      const { status, outputs, error } = response.data;
      logger.debug('muapi.ai poll', { predictionId, status, attempt: attempts });

      if (status === 'completed') {
        const url = Array.isArray(outputs) ? outputs[0] : outputs;
        if (!url) {
          throw new Error('muapi.ai task completed but no output URL found in result');
        }
        return { url };
      } else if (status === 'failed') {
        throw new Error(`muapi.ai task failed: ${error || 'unknown error'}`);
      }
      // queued / processing — keep polling
    }
    throw new Error('muapi.ai polling timeout');
  }

  // ── REPLICATE: SHARED HEADERS ─────────────
  // Used ONLY by the optional 4K upscale pass now — Kling and Aleph both
  // moved to muapi.ai (see file header).
  replicateHeaders() {
    if (!process.env.REPLICATE_API_KEY) {
      throw new Error('REPLICATE_API_KEY not set — required for the optional 4K upscale pass (ENABLE_UPSCALE=true)');
    }
    return {
      Authorization: `Token ${process.env.REPLICATE_API_KEY}`,
      'Content-Type': 'application/json',
    };
  }

  // ── REPLICATE: GENERIC NAME-BASED SUBMIT ──
  // Uses the /v1/models/{owner}/{name}/predictions endpoint, which runs
  // the model's latest version by name — no version hash needed. Only
  // upscaleVideo() routes through here now (Aleph moved to muapi.ai).
  async submitReplicateModel(modelSlug, input) {
    const cleanInput = Object.fromEntries(
      Object.entries(input).filter(([, v]) => v !== undefined && v !== null)
    );

    const response = await axios.post(
      `https://api.replicate.com/v1/models/${modelSlug}/predictions`,
      { input: cleanInput },
      { headers: this.replicateHeaders() }
    );

    const predictionId = response.data?.id;
    if (!predictionId) {
      throw new Error(`Replicate submit to model "${modelSlug}" returned no prediction id`);
    }
    return predictionId;
  }

  // ── POLLING: REPLICATE ───────────────────
  // Only used by the optional upscale pass now.
  async pollReplicate(predictionId, pollingOverride) {
    const { intervalMs, maxAttempts } = pollingOverride || config.polling;
    let attempts = 0;

    while (attempts < maxAttempts) {
      await sleep(intervalMs);
      attempts++;

      const response = await axios.get(
        `https://api.replicate.com/v1/predictions/${predictionId}`,
        { headers: this.replicateHeaders() }
      );

      const { status, output, error } = response.data;
      logger.debug('Replicate poll', { predictionId, status, attempt: attempts });

      if (status === 'succeeded') {
        // For video models, the final/most-complete output is typically
        // the last element when output is an array (vs. output[0], which
        // was the old behavior — fine for upscale's single-image output,
        // but wrong for video-to-video models that may return progressive
        // outputs).
        const url = Array.isArray(output) ? output[output.length - 1] : output;
        return { url, predictionId };
      } else if (status === 'failed' || status === 'canceled') {
        throw new Error(`Replicate prediction failed: ${error || status}`);
      }
    }
    throw new Error('Replicate polling timeout');
  }

  sleep(ms) {
    return sleep(ms);
  }
}

module.exports = VideoGenerator;
