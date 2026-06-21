// tests/video/generator.test.js
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('fs-extra', () => ({
  ensureDirSync: jest.fn(),
}), { virtual: true });

jest.mock('axios', () => ({
  post: jest.fn(),
  get: jest.fn(),
}), { virtual: true });

// Bypass real backoff delays / retry loops so tests run instantly. withRetry
// is reduced to "call fn once and return/throw whatever it does".
jest.mock('../../src/utils/retry', () => ({
  withRetry: jest.fn((fn) => fn()),
  sleep: jest.fn(() => Promise.resolve()),
}));

// phases/prompts are theme content now, NOT engine config — config only
// carries engine-level upscale + polling settings.
jest.mock('../../config/pipeline.config', () => ({
  upscale: { enabled: false, model: 'test-upscale-model', scale: 2 },
  polling: { intervalMs: 1, maxAttempts: 3 },
}));

const axios = require('axios');
const config = require('../../config/pipeline.config');
const VideoGenerator = require('../../src/video/generator');
const mockTheme = require('../fixtures/mockTheme');

describe('VideoGenerator', () => {
  let generator;

  beforeEach(() => {
    jest.clearAllMocks();
    config.upscale.enabled = false;
    config.polling.maxAttempts = 3;
    generator = new VideoGenerator(mockTheme);
  });

  describe('constructor / requireTheme guard', () => {
    it('rejects when no theme was injected', async () => {
      const bare = new VideoGenerator();
      await expect(bare.generatePhase1()).rejects.toThrow(
        /VideoGenerator requires a theme/
      );
    });
  });

  describe('generatePhase1 (Runway)', () => {
    it('submits to Runway and polls until SUCCEEDED', async () => {
      axios.post.mockResolvedValueOnce({ data: { id: 'runway-task-1' } });
      axios.get.mockResolvedValueOnce({
        data: { status: 'SUCCEEDED', output: ['https://cdn.example/phase1.mp4'] },
      });

      const result = await generator.generatePhase1();

      expect(result).toEqual({ url: 'https://cdn.example/phase1.mp4', taskId: 'runway-task-1' });
      expect(axios.post).toHaveBeenCalledWith(
        'https://api.dev.runwayml.com/v1/image_to_video',
        expect.objectContaining({ promptText: 'phase1 prompt', duration: 5 }),
        expect.any(Object)
      );
    });

    it('throws a wrapped error when the Runway task fails', async () => {
      axios.post.mockResolvedValueOnce({ data: { id: 'runway-task-2' } });
      axios.get.mockResolvedValueOnce({
        data: { status: 'FAILED', failure: 'content policy violation' },
      });

      await expect(generator.generatePhase1()).rejects.toThrow(
        'Phase 1 generation failed: Runway task failed: content policy violation'
      );
    });

    it('times out after exhausting all polling attempts', async () => {
      axios.post.mockResolvedValueOnce({ data: { id: 'runway-task-3' } });
      axios.get.mockResolvedValue({ data: { status: 'RUNNING' } });

      await expect(generator.generatePhase1()).rejects.toThrow(
        'Phase 1 generation failed: Runway polling timeout'
      );
      expect(axios.get).toHaveBeenCalledTimes(3);
    });
  });

  describe('generatePhase2 (Kling)', () => {
    it('submits to Kling and polls until succeed', async () => {
      axios.post.mockResolvedValueOnce({ data: { data: { task_id: 'kling-task-1' } } });
      axios.get.mockResolvedValueOnce({
        data: {
          data: {
            task_status: 'succeed',
            task_result: { videos: [{ url: 'https://cdn.example/phase2.mp4' }] },
          },
        },
      });

      const result = await generator.generatePhase2('https://cdn.example/phase1.mp4');

      expect(result).toEqual({ url: 'https://cdn.example/phase2.mp4', taskId: 'kling-task-1' });
      expect(axios.post).toHaveBeenCalledWith(
        'https://api.klingai.com/v1/videos/video-to-video',
        expect.objectContaining({
          input_video_url: 'https://cdn.example/phase1.mp4',
          prompt: 'phase2 prompt',
        }),
        expect.any(Object)
      );
    });

    it('throws when Kling reports a failed task', async () => {
      axios.post.mockResolvedValueOnce({ data: { data: { task_id: 'kling-task-2' } } });
      axios.get.mockResolvedValueOnce({ data: { data: { task_status: 'failed' } } });

      await expect(generator.generatePhase2('https://cdn.example/phase1.mp4')).rejects.toThrow(
        'Phase 2 generation failed: Kling task failed'
      );
    });
  });

  describe('generatePhase3 (Pika)', () => {
    it('submits to Pika and polls until finished', async () => {
      axios.post.mockResolvedValueOnce({ data: { id: 'pika-task-1' } });
      axios.get.mockResolvedValueOnce({
        data: { status: 'finished', videos: [{ resultUrl: 'https://cdn.example/phase3.mp4' }] },
      });

      const result = await generator.generatePhase3();

      expect(result).toEqual({ url: 'https://cdn.example/phase3.mp4', taskId: 'pika-task-1' });
    });

    it('throws when Pika reports a failed job', async () => {
      axios.post.mockResolvedValueOnce({ data: { id: 'pika-task-2' } });
      axios.get.mockResolvedValueOnce({ data: { status: 'failed' } });

      await expect(generator.generatePhase3()).rejects.toThrow(
        'Phase 3 generation failed: Pika task failed'
      );
    });
  });

  describe('upscaleVideo', () => {
    it('skips the upscale call entirely when disabled in config', async () => {
      config.upscale.enabled = false;
      const result = await generator.upscaleVideo('https://cdn.example/master.mp4');

      expect(result).toEqual({ url: 'https://cdn.example/master.mp4', upscaled: false });
      expect(axios.post).not.toHaveBeenCalled();
    });

    it('returns the upscaled url on success', async () => {
      config.upscale.enabled = true;
      axios.post.mockResolvedValueOnce({ data: { id: 'replicate-pred-1' } });
      axios.get.mockResolvedValueOnce({
        data: { status: 'succeeded', output: ['https://cdn.example/master_4k.mp4'] },
      });

      const result = await generator.upscaleVideo('https://cdn.example/master.mp4');

      expect(result).toEqual({
        url: 'https://cdn.example/master_4k.mp4',
        predictionId: 'replicate-pred-1',
        upscaled: true,
      });
    });

    it('falls back to the original video when the upscale call fails', async () => {
      config.upscale.enabled = true;
      axios.post.mockRejectedValueOnce(new Error('Replicate is down'));

      const result = await generator.upscaleVideo('https://cdn.example/master.mp4');

      expect(result).toEqual({
        url: 'https://cdn.example/master.mp4',
        upscaled: false,
        error: 'Replicate is down',
      });
    });
  });
});
