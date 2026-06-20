# 🛸 Jagannatha SciFi Video Pipeline

> **Sacred Meets Sci-Fi** — AI-powered video generation pipeline for the Shree Jagannatha Temple Rath Yatra, with cinematic sci-fi transformation effects.

Built by **Ashish Gupta** — [Digital Builders](https://ashishgupta.dev)

**JAI JAGANNATH! 🙏🪔🎆**

---

## 🎬 What This Pipeline Does

Automatically generates a **15-second cinematic sci-fi transformation video** of the Jagannatha Rath Yatra using multiple AI services, assembles the video with FFmpeg, and publishes to all social media platforms.

### Transformation Phases
| Phase | Duration | Provider | Description |
|-------|----------|----------|-------------|
| 1 | 5 sec | Runway Gen-3 | Sacred baseline — diyas, chariots, crowd |
| 2 | 10 sec | Kling AI Pro | SciFi transformation — quantum portals, robots |
| 3 | 5 sec (return) | Pika Labs | Sacred return — energy withdraws back |

### Audio Layers
- 🥁 **Sacred Audio** — mardala, conch, Jai Jagannath chant (ElevenLabs)
- ⚡ **SciFi Audio** — quantum portal, robot army, plasma beams (ElevenLabs)
- 🎼 **Music Score** — Carnatic + orchestral + electronic hybrid (Suno AI)

---

## 🏗️ Architecture

```
Oracle Cloud Free Tier (Always Free)
├── ARM VM (4 OCPU, 24GB RAM)
│   ├── n8n (workflow automation)
│   ├── Node.js pipeline
│   └── FFmpeg (video assembly)
└── Object Storage (20GB)
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
- Oracle Cloud account (free tier)
- Node.js 20+
- API keys for all services (see `.env.example`)

### 1. Clone & Install
```bash
git clone https://github.com/YOUR_USERNAME/jagannatha-pipeline.git
cd jagannatha-pipeline
npm install
cp .env.example .env
# Fill in your API keys in .env
```

### 2. Setup Oracle Cloud VM
```bash
# SSH into your Oracle VM then run:
bash scripts/setup.sh
```

### 3. Test API Connections
```bash
npm run test-apis
```

### 4. Run Pipeline
```bash
# Full pipeline (generate + publish)
npm run generate

# Generate only (skip publishing)
node src/index.js generate --skip-publish

# Publish pre-generated videos
npm run publish
```

### 5. Import n8n Workflow
1. Open n8n at `http://YOUR_VM_IP:5678`
2. Go to **Workflows → Import**
3. Upload `n8n/workflows/main-pipeline.workflow.json`
4. Configure credentials
5. Activate workflow

---

## 📁 Project Structure

```
jagannatha-pipeline/
├── src/
│   ├── index.js              # Main entry point
│   ├── video/
│   │   └── generator.js      # Runway + Kling + Pika
│   ├── audio/
│   │   └── generator.js      # ElevenLabs + Suno
│   ├── assembly/
│   │   └── assembler.js      # FFmpeg video assembly
│   ├── publish/
│   │   └── publisher.js      # All platform publishing
│   └── utils/
│       └── logger.js         # Winston logger
├── tests/                     # Jest unit tests (mirrors src/ layout)
│   ├── utils/
│   │   ├── retry.test.js
│   │   └── costTracker.test.js
│   ├── video/generator.test.js
│   ├── audio/generator.test.js
│   ├── assembly/assembler.test.js
│   └── publish/publisher.test.js
├── admin/                     # Admin web UI for pipeline control
│   ├── server.js
│   └── public/
├── monitoring/                # Monitoring dashboard
│   ├── dashboard.html
│   └── server.js
├── n8n/
│   └── workflows/
│       ├── main-pipeline.workflow.json
│       └── error-handler-workflow.json
├── config/
│   └── pipeline.config.js    # Central config
├── scripts/
│   ├── setup.sh              # Oracle Cloud setup
│   ├── deploy.sh             # Deployment script
│   └── test-apis.js          # API connection tester
├── .github/
│   └── workflows/
│       └── deploy.yml        # GitHub Actions CI/CD
├── assets/                   # Base images (gitignored)
├── output/                   # Generated videos (gitignored)
├── temp/                     # Temp files (gitignored)
├── data/                     # cost-log.json (gitignored)
├── .env.example              # Environment template
└── package.json
```

---

## ⚙️ Configuration

All pipeline settings in `config/pipeline.config.js`:

- **Video prompts** — customize sacred & scifi prompts
- **Audio layers** — adjust volumes and prompts
- **Platform exports** — resolution, bitrate per platform
- **Retry/polling** — API timeout settings

---

## 💰 Cost Breakdown

| Service | Monthly Cost | Videos/Month |
|---------|-------------|--------------|
| Starter | $30 (₹2,500) | 4–5 videos |
| Growth | $100 (₹8,300) | 16–20 videos |
| Pro | $300 (₹25,000) | 55–65 videos |
| Oracle Cloud | **$0 always free** | — |

---

## 🐙 GitHub Secrets Required

Add these in **Settings → Secrets → Actions**:

| Secret | Description |
|--------|