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

  // ── POLLING CONFIG ────────────────────────
  polling: {
    intervalMs: 10000,
    maxAttempts: 60,
    timeoutMs: 600000,
  },

  // ── COST ESTIMATES (USD per API call, env-overridable) ──
  // Used by utils/costTracker.js since most providers don't
  // return real-time billing info in their API responses.
  costEstimates: {
    runway: Number(process.env.COST_RUNWAY_PER_CALL || 0.50),
    kling: Number(process.env.COST_KLING_PER_CALL || 0.70),
    pika: Number(process.env.COST_PIKA_PER_CALL || 0.35),
    elevenlabs: Number(process.env.COST_ELEVENLABS_PER_CALL || 0.10),
    suno: Number(process.env.COST_SUNO_PER_CALL || 0.20),
    replicate: Number(process.env.COST_REPLICATE_UPSCALE_PER_CALL || 0.15),
    openai: Number(process.env.COST_OPENAI_PER_CALL || 0.02),
  },

  // ── BUDGET TIERS (for reference in cost reports) ─────────
  budgetTiers: [
    { name: 'Starter', monthlyUsd: 30, videosPerMonth: '4-5' },
    { name: 'Growth', monthlyUsd: 100, videosPerMonth: '16-20' },
    { name: 'Pro', monthlyUsd: 300, videosPerMonth: '55-65' },
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
