# 🛸 SciFi Transformation Video Pipeline

> **Any deity, any location, any product, any business.** AI-powered video generation pipeline that turns a base image into a 15-second cinematic sci-fi transformation video, with subject-specific content driven entirely by a swappable **theme** file.

Built by **Ashish Gupta** — [Digital Builders](https://ashishgupta.dev)

---

## 🎬 What This Pipeline Does

Automatically generates a **15-second, 3-phase cinematic transformation video** — baseline → sci-fi transformation → resolution — using multiple AI services, assembles the video with FFmpeg, and publishes it to all major social platforms.

What the video is *about* lives entirely in a **theme file** (`themes/*.json`), not in the engine code. Point the same pipeline at a temple's Rath Yatra, a sneaker launch, a city skyline, or a SaaS product just by changing `--theme`.

### Transformation Phases
| Phase | Duration | Provider | Description |
|-------|----------|----------|-------------|
| 1 | theme-defined | Runway Gen-3 | Baseline scene, built from the theme's base image + prompt |
| 2 | theme-defined | Kling AI Pro | Sci-fi transformation sequence |
| 3 | theme-defined | Pika Labs | Resolution / hero reveal |

(Exact durations, prompts, and negative prompts for each phase are set per-theme in `themes/*.json`.)

### Audio Layers
- 🎵 **Ambient Audio** — baseline soundscape (ElevenLabs)
- ⚡ **Transformation Audio** — transformation sound design (ElevenLabs)
- 🎼 **Music Score** — full instrumental/vocal score (Suno AI)

All three prompts, durations, and mix volumes are theme-defined.

---

## 🏗️ Architecture

```
Host VM (Oracle Cloud Free Tier or any server)
├── ARM/x86 VM
│   ├── n8n (workflow automation, theme-aware)
│   ├── Node.js pipeline engine
│   └── FFmpeg (video assembly)
└── Object Storage (S3-compatible)
    └── temp videos + assets

External AI Services
├── Runway Gen-3 (phase 1 video)
├── Kling AI Pro (scifi transform)
├── Pika Labs (phase 3)
├── ElevenLabs (sound effects)
└── Suno AI (music score)

Distribution
├── YouTube + YouTube Shorts
├── Instagram Reels
├── Twitter/X
├── Facebook
└── WhatsApp Status
```

---

## 🚀 Quick Start

### Prerequisites
- Node.js 20+
- FFmpeg installed on the host
- API keys for all generation services (see `.env.example`)
- Oracle Cloud account, or any S3-compatible object storage

### 1. Clone & Install
```bash
git clone https://github.com/YOUR_USERNAME/scifi-transformation-pipeline.git
cd scifi-transformation-pipeline
npm install
cp .env.example .env
# Fill in your API keys in .env
```

### 2. Setup the Host VM
```bash
# SSH into your VM then run:
bash scripts/setup.sh
```

### 3. Pick or Create a Theme
```bash
node src/index.js list-themes
# to author a new one:
cp themes/_template.json themes/my-theme.json
# edit themes/my-theme.json — see themes/README.md for the full field reference
```

### 4. Test API Connections
```bash
npm run test-apis
```

### 5. Run Pipeline
```bash
# Full pipeline (generate + publish) for a given theme
node src/index.js generate --theme my-theme

# Or set DEFAULT_THEME in .env and omit --theme entirely
npm run generate

# Generate only (skip publishing)
node src/index.js generate --theme my-theme --skip-publish

# Publish pre-generated videos
node src/index.js publish --theme my-theme --all
```

### 6. Import n8n Workflow
1. Open n8n at `http://YOUR_VM_IP:5678`
2. Go to **Workflows → Import**
3. Upload `n8n/workflows/main-pipeline.workflow.json`
4. Configure credentials, set the `theme` parameter (or rely on `DEFAULT_THEME`)
5. Activate workflow

---

## 📁 Project Structure

```
scifi-transformation-pipeline/
├── src/
│   ├── index.js               # Main entry point — generate/assemble/publish/list-themes
│   ├── video/
│   │   └── generator.js       # Runway + Kling + Pika (theme-driven prompts)
│   ├── audio/
│   │   └── generator.js       # ElevenLabs + Suno (theme-driven prompts)
│   ├── assembly/
│   │   └── assembler.js       # FFmpeg video assembly (theme-driven overlay/mix)
│   ├── publish/
│   │   └── publisher.js       # All platform publishing (theme-driven titles/captions)
│   ├── notify/
│   │   └── whatsapp.js        # WhatsApp Cloud API notifications (theme-templated)
│   └── utils/
│       ├── themeLoader.js     # loads + validates themes/*.json
│       ├── template.js        # {placeholder} substitution for theme notification strings
│       ├── logger.js          # Winston logger
│       ├── retry.js           # exponential-backoff wrapper
│       ├── storage.js         # Oracle/S3-compatible object storage helper
│       ├── costTracker.js     # per-run cost logging + budget tier lookup
│       ├── cronManager.js     # local cron scheduling fallback
│       └── youtubeAuth.js     # OAuth2 token refresh helper
├── themes/
│   ├── README.md              # theme field reference + authoring guide
│   ├── _template.json         # blank starting point for a new theme
│   ├── jagannatha-rathyatra.json   # example: sacred temple Rath Yatra theme
│   └── example-product-launch.json # example: sneaker/product-launch theme
├── tests/                      # Jest unit tests (7 suites, 74 tests, mirrors src/ layout)
│   ├── utils/
│   │   ├── themeLoader.test.js
│   │   ├── retry.test.js
│   │   └── costTracker.test.js
│   ├── video/generator.test.js
│   ├── audio/generator.test.js
│   ├── assembly/assembler.test.js
│   ├── publish/publisher.test.js
│   └── fixtures/mockTheme.js
├── admin/                      # Admin web UI for pipeline control (theme-aware)
│   ├── server.js
│   └── public/
├── monitoring/                 # Monitoring dashboard (cost + run history)
│   ├── dashboard.html
│   └── server.js
├── n8n/
│   └── workflows/               # Orchestration workflows (theme-aware)
│       ├── main-pipeline.workflow.json
│       └── error-handler-workflow.json
├── config/
│   └── pipeline.config.js      # Engine-only config, shared by every theme
├── scripts/
│   ├── setup.sh                # Host VM setup
│   ├── deploy.sh                # Deployment script
│   └── test-apis.js             # API connection tester
├── .github/
│   └── workflows/
│       └── deploy.yml            # GitHub Actions CI/CD
├── assets/                      # Base images (gitignored)
├── output/                      # Generated videos (gitignored)
├── temp/                        # Temp files (gitignored)
├── data/                        # cost-log.json (gitignored)
├── .env.example                 # Environment template
└── package.json
```

---

## ⚙️ Configuration

Two layers, deliberately kept separate:

- **`themes/*.json`** — everything subject-specific: the three phase prompts and durations, the three audio prompts/volumes, on-screen overlay text, branding strings, and per-platform titles/descriptions/captions. This is what you edit to point the pipeline at a new deity, location, product, or business. See `themes/README.md` for the full field reference.
- **`config/pipeline.config.js`** — everything engine-specific and shared across every theme: FFmpeg encode parameters, retry/polling tuning, per-platform resolution/bitrate/crop specs, cost-per-call estimates, budget tiers, and storage connection config.

---

## 💰 Cost Breakdown

| Service | Monthly Cost | Videos/Month |
|---------|-------------|--------------|
| Starter | $30 | 4–5 videos |
| Growth | $100 | 16–20 videos |
| Pro | $300 | 55–65 videos |
| Oracle Cloud (free tier) | $0 | — |

Per-call estimates (`COST_*` env vars, default values): Runway ~$0.50, Kling ~$0.70, Pika ~$0.35, ElevenLabs ~$0.10/call, Suno ~$0.20, Replicate upscale ~$0.15. Run `npm run cost-report` for live totals against your actual usage.

---

## 🐙 GitHub Secrets Required

Add these in **Settings → Secrets → Actions**, plus every API key in `.env.example`:

| Secret | Description |
|--------|-------------|
| `ORACLE_SSH_PRIVATE_KEY` | SSH key for your host VM |
| `ORACLE_VM_IP` | Your host VM's public IP |

---

## 📋 GitHub Actions

| Trigger | Action |
|---------|--------|
| Push to `main` | Auto-deploy to host VM |
| Commit with `[run-pipeline]` | Deploy + run video pipeline (uses `DEFAULT_THEME`) |
| Commit with `[import-n8n]` | Deploy + import n8n workflow |
| Manual dispatch | Deploy with optional pipeline run |

---

## Included Example Themes

- **`jagannatha-rathyatra.json`** — Shree Jagannatha Temple Puri Rath Yatra, sacred-to-sci-fi. The pipeline's original content, kept as a complete devotional example. *Jai Jagannath 🙏*
- **`example-product-launch.json`** — a sneaker/product launch film, included to prove the same engine works for commercial subjects with zero code changes.
- **`_template.json`** — blank starting point for your own theme.

---

*Built with ❤️ by [Ashish Gupta](https://ashishgupta.dev) — Digital Builders, Ludhiana, Punjab, India*
