// config/pipeline.config.js
// Central configuration for entire pipeline

module.exports = {

  // ── PROJECT ──────────────────────────────
  project: {
    name: 'Jagannatha SciFi Sacred Pipeline',
    version: '1.0.0',
    author: 'Ashish Gupta — Digital Builders',
  },

  // ── VIDEO PHASES ─────────────────────────
  phases: {
    phase1: {
      name: 'Sacred Baseline',
      duration: 5,
      provider: 'runway',
      prompt: `Sacred Jagannatha Temple Puri night
        scene, Rath Yatra procession, thousands
        of diyas, three chariots Nandighosa
        Taladhwaja Darpadalana, Bay of Bengal,
        cinematic drone orbit clockwise,
        golden sacred lighting, devotees,
        fireworks, 24fps, ultra-realistic`,
      negativePrompt: 'blur, cartoon, low quality',
    },
    phase2: {
      name: 'SciFi Transformation',
      duration: 10,
      provider: 'kling',
      prompt: `SCIFI SACRED TRANSFORMATION:
        Temple sandstone cracks revealing plasma
        energy cores, Nilachakra becomes quantum
        portal wormhole, three chariots levitate
        with anti-gravity energy rings, devotees
        flicker as holograms, divine Vimana
        spacecraft lotus-shaped descends, chrome
        Garuda robot eagle 40-meter wingspan,
        sacred geometry Sri Chakra gold energy
        lines overlay, Earth from orbit Puri as
        energy nexus glowing point, robotic divine
        army Navagraha mechs, Jagannatha eyes
        fire golden divine laser beams,
        cinematic sci-fi sacred epic`,
      negativePrompt: `disrespectful, ugly,
        distorted, cartoon, low quality,
        morphing artifacts`,
    },
    phase3: {
      name: 'Sacred Return',
      duration: 5,
      provider: 'pika',
      prompt: `Gentle reverse transformation,
        energy withdrawing into temple, robots
        dissolving into sacred light flower
        petals, chariots descending back to
        ground, temple restoring to sandstone
        with subtle golden inner glow,
        Jagannatha eyes with tiny blue plasma
        ring, final sacred peace, diya flames,
        crowd in divine joy tears`,
      negativePrompt: 'abrupt, jarring, low quality',
    },
  },

  // ── 4K UPSCALE (optional, Replicate) ─────
  upscale: {
    enabled: process.env.ENABLE_UPSCALE === 'true',
    model: process.env.REPLICATE_UPSCALE_MODEL || 'nightmareai/real-esrgan',
    scale: 2,
  },

  // ── AUDIO LAYERS ─────────────────────────
  audio: {
    sacred: {
      prompt: `Sacred Hindu temple bells mardala
        drums Jai Jagannath crowd chant conch
        shell mahuri wind instrument Rath Yatra
        procession Bay of Bengal ocean waves
        diya crackle marigold festival night Puri`,
      duration: 15,
      volume: 1.0,
    },
    scifi: {
      prompt: `Quantum portal opening bass whomp
        anti-gravity engine powering up tesla
        coil electrical discharge robotic
        footsteps chrome eagle screech plasma
        energy beams Sanskrit mantra cosmic
        drone reactor activation Vimana
        spacecraft descent dimensional portal`,
      duration: 15,
      volume: 0.85,
    },
    music: {
      prompt: `[Sacred Carnatic classical opening
        mardala conch temple bells] [Orchestral
        swell Hans Zimmer meets Odishan devotional
        rising intensity] [Full electronic sci-fi
        orchestra vocoder Sanskrit chant massive
        bass drops cosmic scale divine energy]
        [Gentle sacred return bells human voices
        ocean wave] cinematic sacred transformation`,
      duration: 15,
      volume: 0.65,
      instrumental: true,
    },
  },

  // ── VIDEO ASSEMBLY ────────────────────────
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
    overlayText: {
      sanskrit: 'जगन्नाथ स्वामी नयन पथ गामी भवतु मे',
      english: 'JAI JAGANNATH 🙏',
      startTime: 13,
      endTime: 15,
      fadeIn: 0.5,
      fadeOut: 0.5,
    },
  },

  // ── PLATFORM EXPORTS ──────────────────────
  platforms: {
    youtube: {
      resolution: '1080x1080',
      bitrate: '8000k',
      audioBitrate: '320k',
      format: 'mp4',
      filename: 'youtube_1080.mp4',
      title: 'Jagannatha Rath Yatra SciFi 🤖🛸 Sacred Meets Cyberpunk | JAI JAGANNATH 🙏',
      tags: ['JaiJagannath', 'RathYatra', 'SciFi', 'Puri', 'Odisha', 'AIVideo'],
      categoryId: '22',
      privacy: 'public',
    },
    instagramReel: {
      resolution: '1080x1080',
      bitrate: '8000k',
      audioBitrate: '192k',
      format: 'mp4',
      filename: 'ig_reel_1080.mp4',
      caption: `🤖⚡ SACRED MEETS SCI-FI ⚡🤖\n\nJagannatha Temple transforms into quantum energy reactor 🛸\n\nJAI JAGANNATH! 🙏🪔\n\n#JaiJagannath #RathYatra #SciFi #Puri #Odisha #AIVideo #HinduSciFi`,
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
    bucket: process.env.ORACLE_BUCKET || 'jagannatha-pipeline',
    accessKeyId: process.env.ORACLE_S3_ACCESS_KEY,
    secretAccessKey: process.env.ORACLE_S3_SECRET_KEY,
  },
};
