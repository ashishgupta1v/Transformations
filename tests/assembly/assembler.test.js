// tests/assembly/assembler.test.js
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

// assembler.js shells out to ffmpeg via child_process.exec (promisified),
// NOT fluent-ffmpeg, so we mock child_process directly.
const mockExec = jest.fn((cmd, callback) => callback(null, 'stdout', ''));
jest.mock('child_process', () => ({
  exec: (...args) => mockExec(...args),
}));

jest.mock('fs-extra', () => ({
  ensureDirSync: jest.fn(),
  copy: jest.fn().mockResolvedValue(),
  writeFile: jest.fn().mockResolvedValue(),
  stat: jest.fn().mockResolvedValue({ size: 10 * 1024 * 1024 }),
}), { virtual: true });

jest.mock('axios', () => ({
  get: jest.fn(),
}), { virtual: true });

jest.mock('../../src/utils/retry', () => ({
  withRetry: jest.fn((fn) => fn()),
}));

jest.mock('../../config/pipeline.config', () => ({
  audio: {
    sacred: { volume: 1.0 },
    scifi: { volume: 0.85 },
    music: { volume: 0.65 },
  },
  assembly: {
    overlayText: {
      english: 'JAI JAGANNATH',
      startTime: 13,
      endTime: 15,
      fadeIn: 0.5,
      fadeOut: 0.5,
    },
  },
  platforms: {
    youtube: {
      resolution: '1080x1080',
      bitrate: '8000k',
      audioBitrate: '320k',
      filename: 'youtube_1080.mp4',
    },
    shorts: {
      resolution: '1080x1920',
      bitrate: '8000k',
      audioBitrate: '192k',
      filename: 'shorts_1080x1920.mp4',
      cropFilter: 'crop=608:1080:236:0,scale=1080:1920',
    },
  },
}));

const axios = require('axios');
const fs = require('fs-extra');
const VideoAssembler = require('../../src/assembly/assembler');

describe('VideoAssembler', () => {
  let assembler;

  beforeEach(() => {
    jest.clearAllMocks();
    mockExec.mockImplementation((cmd, callback) => callback(null, 'stdout', ''));
    fs.stat.mockResolvedValue({ size: 10 * 1024 * 1024 });
    assembler = new VideoAssembler();
  });

  describe('downloadAssets', () => {
    it('downloads http(s) assets via axios and copies file:// assets locally', async () => {
      axios.get.mockResolvedValue({ data: Buffer.from('bytes') });

      await assembler.downloadAssets({
        phase1: 'https://cdn.example/phase1.mp4',
        phase2: 'https://cdn.example/phase2.mp4',
        phase3: 'https://cdn.example/phase3.mp4',
        sacredAudio: 'file:///tmp/sacred_audio.mp3',
        scifiAudio: 'file:///tmp/scifi_audio.mp3',
        musicScore: 'https://cdn.example/music.mp3',
      });

      // phase1, phase2, phase3, musicScore are http downloads
      expect(axios.get).toHaveBeenCalledTimes(4);
      expect(fs.writeFile).toHaveBeenCalledTimes(4);
      // sacredAudio + scifiAudio are local file:// copies
      expect(fs.copy).toHaveBeenCalledTimes(2);
      expect(fs.copy).toHaveBeenCalledWith(
        '/tmp/sacred_audio.mp3',
        expect.stringContaining('sacred_audio.mp3')
      );
    });

    it('skips urls that are not provided', async () => {
      axios.get.mockResolvedValue({ data: Buffer.from('bytes') });

      await assembler.downloadAssets({
        phase1: 'https://cdn.example/phase1.mp4',
        phase2: 'https://cdn.example/phase2.mp4',
        phase3: 'https://cdn.example/phase3.mp4',
      });

      expect(axios.get).toHaveBeenCalledTimes(3);
      expect(fs.copy).not.toHaveBeenCalled();
    });
  });

  describe('mixAudio', () => {
    it('builds an ffmpeg amix command using config volumes and returns the output path', async () => {
      const result = await assembler.mixAudio();

      expect(mockExec).toHaveBeenCalledTimes(1);
      const [cmd] = mockExec.mock.calls[0];
      expect(cmd).toContain('volume=1'); // sacred volume
      expect(cmd).toContain('volume=0.85'); // scifi volume
      expect(cmd).toContain('volume=0.65'); // music volume
      expect(cmd).toContain('amix=inputs=3');
      expect(result).toContain('final_audio.mp3');
    });
  });

  describe('assembleFinalVideo', () => {
    it('writes a concat file, runs ffmpeg, and reports the output size', async () => {
      const result = await assembler.assembleFinalVideo();

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('concat.txt'),
        expect.stringContaining('phase1.mp4')
      );
      expect(mockExec).toHaveBeenCalledTimes(1);
      const [cmd] = mockExec.mock.calls[0];
      expect(cmd).toContain("text='JAI JAGANNATH'");
      expect(result.path).toContain('master_output.mp4');
      expect(result.size).toBe(10 * 1024 * 1024);
      expect(result.sizeHuman).toBe('10.0MB');
    });
  });

  describe('exportPlatformVersions', () => {
    it('exports every platform and isolates a failure to just that platform', async () => {
      mockExec.mockImplementation((cmd, callback) => {
        if (cmd.includes('shorts_1080x1920.mp4')) {
          return callback(new Error('ffmpeg crashed on vertical crop'));
        }
        return callback(null, 'stdout', '');
      });
      fs.stat.mockResolvedValue({ size: 5 * 1024 * 1024 });

      const exports = await assembler.exportPlatformVersions('./output/master_output.mp4');

      expect(exports.youtube.path).toContain('youtube_1080.mp4');
      expect(exports.youtube.size).toBe('5.0MB');
      expect(exports.shorts.error).toBe('ffmpeg crashed on vertical crop');
      expect(exports.shorts.path).toBeUndefined();
    });

    it('uses the resolution scale filter when no cropFilter is configured', async () => {
      await assembler.exportPlatformVersions('./output/master_output.mp4');

      const youtubeCall = mockExec.mock.calls.find(([cmd]) => cmd.includes('youtube_1080.mp4'));
      expect(youtubeCall[0]).toContain('scale=1080x1080');

      const shortsCall = mockExec.mock.calls.find(([cmd]) => cmd.includes('shorts_1080x1920.mp4'));
      expect(shortsCall[0]).toContain('crop=608:1080:236:0,scale=1080:1920');
    });
  });
});
