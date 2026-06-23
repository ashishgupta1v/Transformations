// config/pipeline.config.js
// Engine-level configuration shared by every theme: FFmpeg encode params,
// platform technical specs, retry/polling tuning, cost estimates, budget
// tiers, and Oracle storage connection config. None of this is subject
// (deity/location/product/business) specific — that content lives in
// themes/*.json and is loaded via src/utils/themeLoader.js. See
// themes/README.md for the engine-vs-theme split.

module.exports = {

  // ── 4K UPSCALE (optional, Replicate) ─────
  upscale: {
    enabled: process.env.ENABLE_UPSCALE === 'true',
    model: process.env.REPLICATE_UPSCALE_MODEL || 'nightmareai/real-esrgan',
    scale: 2,
  },

  // ── CONTINUITY (2026-06, Option B reintroduction; 2026-06 muapi migration) ──
  // Tier A = each phase is an independent muapi.ai Kling image-to-video call
  //          (the pure-budget baseline; weakest continuity).
  // Tier B = free ffmpeg last-frame extraction chains phase N's final
  //          frame into phase N+1's starting image. $0 extra cost.
  // Tier C = phase2 is a true video-to-video transform of phase1's actual
  //          rendered clip via Runway Gen-4 Aleph on muapi.ai
  //          (runway-aleph-v2v), then phase3 chains from Tier C's
  //          real last frame via the same free ffmpeg extraction as Tier B.
  //          This is "Option B": 5s (Kling i2v) + flat-cost Aleph v2v + 5s
  //          (Kling i2v from Aleph's last frame) = 15s total, matching
  //          assembly.totalDuration below.
  // SCHEMA CONFIRMED (2026-06) via muapi.ai's public, no-auth
  // GET /api/v1/models/{name} schema endpoint — see DEPLOYMENT_NOTES.md.
  // kling-v2.1-standard-i2v: required prompt/image_url; optional
  // aspect_ratio (16:9|9:16|1:1, default 16:9), duration (5 or 10, step 5).
  // No negative_prompt field — themes' phases.*.negativePrompt is no longer
  // sent to the provider (kept in theme JSON as inert/unused metadata).
  // runway-aleph-v2v: required prompt/video_url; optional aspect_ratio.
  // No duration field — billed as a FLAT per-call cost, not per-second.
  continuity: {
    tier: process.env.CONTINUITY_TIER || 'C', // 'A' | 'B' | 'C'
    aspectRatio: process.env.ASPECT_RATIO || '9:16',
    // muapi model slugs — fixed API endpoints, not swappable model names
    // the way Replicate's owner/name slugs were.
    klingModel: 'kling-v2.1-pro-i2v',
    alephModel: 'runway-aleph-v2v',
    // If Tier C's Aleph call fails (after its own retry budget) or the
    // monthly budget circuit breaker trips, automatically fall back to
    // Tier B for that run rather than failing the whole pipeline.
    fallbackEnabled: process.env.CONTINUITY_FALLBACK_ENABLED !== 'false',
    // ffmpeg brightness/exposure correction pass at the phase1→2 and
    // phase2→3 seams, run during assembly right after downloadAssets().
    colorMatch: process.env.ENABLE_COLOR_MATCH !== 'false',
    // Hold the first N Aleph-generated runs for manual admin review
    // (GET/POST /api/review/*) instead of auto-publishing, since Aleph's
    // actual output quality/cost on this account is unproven at go-live.
    reviewQueue: {
      enabled: process.env.ENABLE_REVIEW_QUEUE !== 'false',
      limit: Number(process.env.REVIEW_QUEUE_LIMIT || 8),
    },
    // True per-phase human-in-the-loop gate (#113), distinct from the
    // Aleph-only reviewQueue above. When enabled, runPipeline() pauses
    // after EVERY phase (1, 2, 3) — not just before publish — and waits
    // for an admin to approve via POST /api/phase-review/:runId/approve
    // (admin/server.js) before continuing to the next phase. State is
    // persisted to disk between phases by src/utils/phaseGate.js so the
    // pause survives a worker restart. Off by default: this triples the
    // number of admin touchpoints per run and is meant for cautious
    // early rollout, not steady-state automated operation.
    perPhaseGate: {
      enabled: process.env.ENABLE_PER_PHASE_GATE === 'true',
    },
  },

  // ── BUDGET CIRCUIT BREAKER ────────────────
  // Hard stop on the single most expensive call type (Aleph) before it
  // executes, independent of the informational-only budgetTiers below.
  circuitBreaker: {
    budgetCapUsd: Number(process.env.MONTHLY_BUDGET_CAP_USD || 50),
  },

  // ── VIDEO ASSEMBLY (encode params only — overlay text/timing is per-theme) ──
  assembly: {
    totalDuration: 15,
    fps: 24,
    resolution: '1080x1080',
    codec: 'libx264',
    preset: 'slow',
    crf: 18,
    pixFmt: 'yuv420p',
    audioCodec: 'aac',
    audioBitrate: '320k',
    videoBitrate: '8000k',
    colorSpace: 'bt709',
  },

  // ── PLATFORM EXPORTS (technical specs only — title/caption/tags are per-theme) ──
  platforms: {
    youtube: {
      resolution: '1080x1080',
      bitrate: '8000k',
      audioBitrate: '320k',
      format: 'mp4',
      filename: 'youtube_1080.mp4',
    },
    instagramReel: {
      resolution: '1080x1080',
      bitrate: '8000k',
      audioBitrate: '192k',
      format: 'mp4',
      filename: 'ig_reel_1080.mp4',
    },
    shorts: {
      resolution: '1080x1920',
      bitrate: '8000k',
      audioBitrate: '192k',
      format: 'mp4',
      filename: 'shorts_1080x1920.mp4',
      cropFilter: 'crop=608:1080:236:0,scale=1080:1920',
    },
    twitter: {
      resolution: '1080x1080',
      bitrate: '5000k',
      audioBitrate: '192k',
      format: 'mp4',
      filename: 'twitter_1080.mp4',
    },
    whatsapp: {
      resolution: '720x720',
      bitrate: '2000k',
      audioBitrate: '128k',
      format: 'mp4',
      filename: 'whatsapp_720.mp4',
    },
    facebook: {
      resolution: '1080x1080',
      bitrate: '8000k',
      audioBitrate: '192k',
      format: 'mp4',
      filename: 'facebook_1080.mp4',
    },
  },

  // ── RETRY CONFIG ──────────────────────────
  retry: {
    maxAttempts: 3,
    delayMs: 5000,
    backoffMultiplier: 2,
  },

  // Aleph-specific retry override: capped at 2 attempts (not 3) because
  // each attempt re-incurs the most expensive call in the pipeline
  // (flat $0.90/call on muapi.ai, confirmed 2026-06). A failed Aleph call
  // falls back to Tier B (see continuity.fallbackEnabled) rather than
  // burning a 3rd attempt.
  retryAleph: {
    maxAttempts: 2,
    delayMs: 10000,
    backoffMultiplier: 2,
  },

  // ── POLLING CONFIG ────────────────────────
  polling: {
    intervalMs: 10000,
    maxAttempts: 60,
    timeoutMs: 600000,
  },

  // Aleph renders take ~15-20 min on Runway's backend regardless of host
  // (vs. Kling's usual <2 min), so it needs a much longer timeout than the
  // default polling config above — using the default's 10-minute ceiling
  // against Aleph caused premature "polling timeout" failures on a call
  // that was actually still succeeding. This timing was established against
  // Replicate's hosting of Aleph; re-verify once real muapi.ai Aleph runs
  // exist, but kept as the safe default until then.
  pollingAleph: {
    intervalMs: 15000,
    maxAttempts: 150, // 150 * 15s = 2250s = 37.5 min ceiling
    timeoutMs: 2250000,
  },

  // ── COST ESTIMATES (USD per API call, env-overridable) ──
  // Used by utils/costTracker.js since most providers don't
  // return real-time billing info in their API responses.
  // 2026-06 muapi.ai migration — confirmed live via muapi's public
  // /api/v1/models/{name} schema + estimate-cost endpoints (no account
  // needed for discovery; see DEPLOYMENT_NOTES.md):
  //   muapiKling ($0.045/s on kling-v2.1-standard-i2v) — a 5s phase call
  //   costs $0.225; phase2's duration can be 5 or 10 (Kling's only allowed
  //   values). This estimate assumes the common 5s case; multiply by
  //   duration/5 for 10s phases when budgeting.
  //   muapiAleph — FLAT $0.90/call regardless of length (no duration
  //   field in muapi's runway-aleph-v2v schema at all).
  //   muapiSuno — FLAT $0.09/call (suno-create-music), up from the old
  //   Suno-reseller's ~$0.05 estimate — a real but small cost increase.
  costEstimates: {
    muapiKling: Number(process.env.COST_MUAPI_KLING_PER_CALL || 0.225),
    elevenlabs: Number(process.env.COST_ELEVENLABS_PER_CALL || 0.10),
    suno: Number(process.env.COST_SUNO_PER_CALL || 0.09),
    replicate: Number(process.env.COST_REPLICATE_UPSCALE_PER_CALL || 0.15),
    openai: Number(process.env.COST_OPENAI_PER_CALL || 0.02),
    // Aleph's cost is a flat per-call rate (see above), but is still routed
    // through costTracker.recordRun()'s variable-cost path (usage.aleph =
    // { calls, totalCost }) rather than the flat-multiplier path, since
    // Tier C calls may fall back to Tier B and shouldn't be double-counted.
    alephPerCall: Number(process.env.COST_MUAPI_ALEPH_PER_CALL || 0.90),
  },

  // ── BUDGET TIERS (for reference in cost reports) ─────────
  budgetTiers: [
    { name: 'Starter', monthlyUsd: 30, videosPerMonth: '15-20 (Tier A/B only)' },
    { name: 'Plus', monthlyUsd: 50, videosPerMonth: '15-20 (Option B w/ Tier C Aleph)' },
    { name: 'Growth', monthlyUsd: 100, videosPerMonth: '60-70' },
    { name: 'Pro', monthlyUsd: 300, videosPerMonth: '200+' },
  ],

  // ── ORACLE OBJECT STORAGE (S3-compatible) ────────────────
  storage: {
    endpoint: process.env.ORACLE_S3_ENDPOINT,
    region: process.env.ORACLE_S3_REGION || 'ap-mumbai-1',
    bucket: process.env.ORACLE_BUCKET || 'pipeline-output',
    accessKeyId: process.env.ORACLE_S3_ACCESS_KEY,
    secretAccessKey: process.env.ORACLE_S3_SECRET_KEY,
  },
};
