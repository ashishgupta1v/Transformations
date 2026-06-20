// src/assembly/assembler.js
// FFmpeg-based video assembly and platform export

const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);
const axios = require('axios');
const fs = require('fs-extra');
const path = require('path');
const logger = require('../utils/logger');
const config = require('../../config/pipeline.config');
const { withRetry } = require('../utils/retry');

class VideoAssembler {
  constructor() {
    this.tempDir = process.env.TEMP_DIR || './temp';
    this.outputDir = process.env.OUTPUT_DIR || './output';
    fs.ensureDirSync(this.tempDir);
    fs.ensureDirSync(this.outputDir);
  }

  // ── DOWNLOAD ALL ASSETS ──────────────────
  async downloadAssets(urls) {
    logger.info('Downloading all assets');

    const downloads = [
      { url: urls.phase1, dest: `${this.tempDir}/phase1.mp4` },
      { url: urls.phase2, dest: `${this.tempDir}/phase2.mp4` },
      { url: urls.phase3, dest: `${this.tempDir}/phase3.mp4` },
      { url: urls.sacredAudio, dest: `${this.tempDir}/sacred_audio.mp3` },
      { url: urls.scifiAudio, dest: `${this.tempDir}/scifi_audio.mp3` },
      { url: urls.musicScore, dest: `${this.tempDir}/music_score.mp3` },
    ].filter((d) => d.url);

    await Promise.all(
      downloads.map(async ({ url, dest }) => {
        // ElevenLabs audio is already written locally by audio/generator.js
        // and exposed as a file:// URL — skip re-downloading those.
        if (url.startsWith('file://')) {
          const localPath = url.replace('file://', '');
          if (path.resolve(localPath) !== path.resolve(dest)) {
            await fs.copy(localPath, dest);
          }
          logger.info(`Copied local asset: ${path.basename(dest)}`);
          return;
        }

        await withRetry(
          async () => {
            const response = await axios.get(url, { responseType: 'arraybuffer' });
            await fs.writeFile(dest, response.data);
          },
          { label: `Download ${path.basename(dest)}` }
        );
        logger.info(`Downloaded: ${path.basename(dest)}`);
      })
    );

    logger.info('All assets downloaded');
  }

  // ── MIX AUDIO LAYERS ────────────────────
  async mixAudio() {
    logger.info('Mixing audio layers with FFmpeg');

    const cmd = `ffmpeg -y \
      -i ${this.tempDir}/sacred_audio.mp3 \
      -i ${this.tempDir}/scifi_audio.mp3 \
      -i ${this.tempDir}/music_score.mp3 \
      -filter_complex " \
        [0:a]volume=${config.audio.sacred.volume},atrim=0:15[sacred]; \
        [1:a]volume=${config.audio.scifi.volume},atrim=0:15[scifi]; \
        [2:a]volume=${config.audio.music.volume},atrim=0:15[music]; \
        [sacred][scifi][music]amix=inputs=3:duration=longest:dropout_transition=2[mixed]; \
        [mixed]afade=t=in:ss=0:d=0.5, \
        afade=t=out:st=14:d=1.0, \
        equalizer=f=80:width_type=o:width=2:g=3, \
        equalizer=f=8000:width_type=o:width=2:g=-1[final_audio] \
      " \
      -map "[final_audio]" \
      -acodec libmp3lame \
      -ab 320k \
      ${this.tempDir}/final_audio.mp3`;

    await execAsync(cmd);
    logger.info('Audio mix complete');
    return `${this.tempDir}/final_audio.mp3`;
  }

  // ── ASSEMBLE FINAL VIDEO ─────────────────
  async assembleFinalVideo() {
    logger.info('Assembling final video');
    const { overlayText } = config.assembly;
    const outputPath = `${this.outputDir}/master_output.mp4`;

    const concatContent = `file '${this.tempDir}/phase1.mp4'\nfile '${this.tempDir}/phase2.mp4'\nfile '${this.tempDir}/phase3.mp4'`;
    const concatFile = `${this.tempDir}/concat.txt`;
    await fs.writeFile(concatFile, concatContent);

    const cmd = `ffmpeg -y \
      -f concat -safe 0 -i ${concatFile} \
      -i ${this.tempDir}/final_audio.mp3 \
      -filter_complex " \
        [0:v]scale=1080:1080,fps=24,setpts=PTS-STARTPTS[v_scaled]; \
        [v_scaled]eq=brightness=0.05:saturation=1.3:contrast=1.1[v_graded]; \
        [v_graded]unsharp=5:5:0.8:5:5:0.0[v_sharp]; \
        [v_sharp]vignette=PI/5[v_vignette]; \
        [v_vignette]drawtext=\
          text='${overlayText.english}': \
          fontsize=52: \
          fontcolor=gold: \
          x=(w-text_w)/2: \
          y=h-110: \
          enable='between(t,${overlayText.startTime},${overlayText.endTime})': \
          alpha='if(between(t,${overlayText.startTime},${overlayText.startTime + overlayText.fadeIn}),(t-${overlayText.startTime})/${overlayText.fadeIn},if(between(t,${overlayText.endTime - overlayText.fadeOut},${overlayText.endTime}),1-(t-${overlayText.endTime - overlayText.fadeOut})/${overlayText.fadeOut},1))'[v_text]; \
        [v_text]drawtext=\
          text='JAI JAGANNATH': \
          fontsize=36: \
          fontcolor=white@0.85: \
          x=(w-text_w)/2: \
          y=h-60: \
          enable='between(t,${overlayText.startTime},${overlayText.endTime})'[v_final] \
      " \
      -map "[v_final]" \
      -map 1:a \
      -vcodec libx264 \
      -preset slow \
      -crf 18 \
      -profile:v high \
      -pix_fmt yuv420p \
      -acodec aac \
      -ab 320k \
      -shortest \
      -movflags +faststart \
      ${outputPath}`;

    await execAsync(cmd);
    logger.info('Master video assembled', { path: outputPath });

    const stats = await fs.stat(outputPath);
    return {
      path: outputPath,
      size: stats.size,
      sizeHuman: `${(stats.size / 1024 / 1024).toFixed(1)}MB`,
    };
  }

  // ── EXPORT PLATFORM VERSIONS ─────────────
  async exportPlatformVersions(masterPath) {
    logger.info('Exporting platform versions');
    const exports = {};

    for (const [platform, cfg] of Object.entries(config.platforms)) {
      try {
        const outputPath = `${this.outputDir}/${cfg.filename}`;
        const cropFilter = cfg.cropFilter
          ? `${cfg.cropFilter}`
          : `scale=${cfg.resolution}`;

        const cmd = `ffmpeg -y \
          -i ${masterPath} \
          -vf "${cropFilter}" \
          -vcodec libx264 \
          -preset fast \
          -b:v ${cfg.bitrate} \
          -acodec aac \
          -ab ${cfg.audioBitrate} \
          -movflags +faststart \
          ${outputPath}`;

        await execAsync(cmd);
        const stats = await fs.stat(outputPath);
        exports[platform] = {
          path: outputPath,
          size: `${(stats.size / 1024 / 1024).toFixed(1)}MB`,
          config: cfg,
        };
        logger.info(`Platform export complete: ${platform}`);

      } catch (error) {
        logger.error(`Platform export failed: ${platform}`, { error: error.message });
        exports[platform] = { error: error.message };
      }
    }

    logger.info('All platform exports complete', {
      count: Object.keys(exports).length,
    });
    return exports;
  }
}

module.exports = VideoAssembler;
