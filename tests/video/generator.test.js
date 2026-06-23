// tests/video/generator.test.js
// PROVIDER NOTE (2026-06): rewritten for the muapi.ai migration — Kling
// image-to-video (all 3 phases) and Runway Gen-4 Aleph video-to-video
// (Tier C continuity) both moved to muapi.ai's submit/poll contract
// (POST /api/v1/{model-name}, GET /api/v1/predictions/{id}/result).
// fal.ai is gone from this file entirely; Replicate is retained only for
// the optional 4K upscale pass (upscaleVideo tests below are otherwise
// unchanged from the prior fal.ai-era suite).

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('fs-extra', () => ({
  ensureDirSync: jest.fn(),
  ensureDir: jest.fn().mockResolvedValue(),
  writeFile: jest.fn().mockResolvedValue(),
  remove: jest.fn().mockResolvedValue(),
  copy: jest.fn().mockResolvedValue(),
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

// Last-frame extraction (Tier B/C chaining) — mocked so tests don't need
// real ffmpeg or real video bytes.
jest.mock('../../src/utils/ffmpegHelpers', () => ({
  extractLastFrame: jest.fn().mockResolvedValue(),
  toDataUri: jest.fn().mockResolvedValue('data:image/png;base64,FAKEFRAME'),
}));

jest.mock('../../src/utils/costTracker', () => ({
  checkBudgetCircuitBreaker: jest.fn().mockResolvedValue({ allowed: true }),
}));

jest.mock('../../src/utils/storage', () => ({
  uploadFile: jest.fn().mockResolvedValue({ url: 'https://cdn.example/uploaded_frame.png' }),
  testConnection: jest.fn().mockResolvedValue(),
}));

// phases/prompts are theme content now, NOT engine config — config only
// carries engine-level upscale/continuity/polling/cost settings.
jest.mock('../../config/pipeline.config', () => ({
  upscale: { enabled: false, model: 'test-upscale-model', scale: 2 },
  polling: { intervalMs: 1, maxAttempts: 3 },
  pollingAleph: { intervalMs: 1, maxAttempts: 3 },
  retryAleph: { maxAttempts: 2, delayMs: 1, backoffMultiplier: 2 },
  continuity: {
    tier: 'A',
    klingModel: 'kling-v2.1-standard-i2v',
    alephModel: 'runway-aleph-v2v',
    fallbackEnabled: true,
    colorMatch: true,
    reviewQueue: { enabled: true, limit: 8 },
  },
  costEstimates: {
    muapiKling: 0.225,
    alephPerCall: 0.90,
  },
  circuitBreaker: { budgetCapUsd: 50 },
}));

const axios = require('axios');
const config = require('../../config/pipeline.config');
const costTracker = require('../../src/utils/costTracker');
const ffmpegHelpers = require('../../src/utils/ffmpegHelpers');
const VideoGenerator = require('../../src/video/generator');
const mockTheme = require('../fixtures/mockTheme');

const MUAPI_BASE_URL = 'https://api.muapi.ai/api/v1';
const KLING_MODEL = 'kling-v2.1-standard-i2v';
const ALEPH_MODEL = 'runway-aleph-v2v';
const KLING_URL = `${MUAPI_BASE_URL}/${KLING_MODEL}`;
const ALEPH_URL = `${MUAPI_BASE_URL}/${ALEPH_MODEL}`;

beforeEach(() => {
  process.env.MUAPI_API_KEY = 'test-muapi-key';
  process.env.REPLICATE_API_KEY = 'test-replicate-key'; // required for the optional 4K upscale pass
  delete process.env.MUAPI_BASE_URL; // exercise the default base URL constant
});

describe('VideoGenerator', () => {
  let generator;

  beforeEach(() => {
    jest.clearAllMocks();
    config.upscale.enabled = false;
    config.polling.maxAttempts = 3;
    config.continuity.tier = 'A';
    config.continuity.fallbackEnabled = true;
    costTracker.checkBudgetCircuitBreaker.mockResolvedValue({ allowed: true });
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

  describe('muapiHeaders guard', () => {
    it('throws when MUAPI_API_KEY is not set', async () => {
      delete process.env.MUAPI_API_KEY;
      await expect(generator.generatePhase1()).rejects.toThrow(
        /MUAPI_API_KEY not set/
      );
    });
  });

  describe('generatePhase1 (muapi.ai Kling image-to-video)', () => {
    it('submits theme.baseImageUrl + phase1 prompt (duration clamped to 5) and polls until completed', async () => {
      axios.post.mockResolvedValueOnce({ data: { request_id: 'muapi-req-1' } });
      axios.get
        .mockResolvedValueOnce({ data: { status: 'processing' } })
        .mockResolvedValueOnce({ data: { status: 'completed', outputs: ['https://cdn.example/phase1.mp4'] } });

      const result = await generator.generatePhase1();

      expect(result).toEqual({
        url: 'https://cdn.example/phase1.mp4',
        taskId: 'muapi-req-1',
        provider: 'muapiKling',
        tier: 'A',
        costUsd: 0.225,
      });
      expect(axios.post).toHaveBeenCalledWith(
        KLING_URL,
        { prompt: 'phase1 prompt', image_url: 'https://cdn.example/base.png', duration: 5, aspect_ratio: '9:16' },
        expect.objectContaining({
          headers: expect.objectContaining({ 'x-api-key': 'test-muapi-key' }),
        })
      );
    });

    it('handles a single-string outputs field (not just an array)', async () => {
      axios.post.mockResolvedValueOnce({ data: { request_id: 'muapi-req-1b' } });
      axios.get.mockResolvedValueOnce({
        data: { status: 'completed', outputs: 'https://cdn.example/phase1-alt.mp4' },
      });

      const result = await generator.generatePhase1();

      expect(result.url).toBe('https://cdn.example/phase1-alt.mp4');
      expect(result.taskId).toBe('muapi-req-1b');
    });

    it('throws a wrapped error when the muapi.ai task reports failed', async () => {
      axios.post.mockResolvedValueOnce({ data: { request_id: 'muapi-req-2' } });
      axios.get.mockResolvedValueOnce({ data: { status: 'failed', error: 'render error' } });

      await expect(generator.generatePhase1()).rejects.toThrow(
        'Phase 1 generation failed: muapi.ai task failed: render error'
      );
    });

    it('times out after exhausting all polling attempts', async () => {
      axios.post.mockResolvedValueOnce({ data: { request_id: 'muapi-req-3' } });
      axios.get.mockResolvedValue({ data: { status: 'processing' } });

      await expect(generator.generatePhase1()).rejects.toThrow(
        'Phase 1 generation failed: muapi.ai polling timeout'
      );
      expect(axios.get).toHaveBeenCalledTimes(3);
    });

    it('throws when the muapi.ai submit response has no request_id/id', async () => {
      axios.post.mockResolvedValueOnce({ data: {} });

      await expect(generator.generatePhase1()).rejects.toThrow(
        /no prediction\/request id/
      );
    });
  });

  describe('generatePhase2 — Tier A (independent muapi.ai Kling call)', () => {
    it('submits an independent call with duration clamped to 10', async () => {
      axios.post.mockResolvedValueOnce({ data: { request_id: 'muapi-req-5' } });
      axios.get.mockResolvedValueOnce({
        data: { status: 'completed', outputs: ['https://cdn.example/phase2.mp4'] },
      });

      const result = await generator.generatePhase2();

      expect(result).toEqual({
        url: 'https://cdn.example/phase2.mp4',
        taskId: 'muapi-req-5',
        provider: 'muapiKling',
        tier: 'A',
        costUsd: 0.45, // costEstimates.muapiKling (0.225) * (10/5)
      });
      expect(axios.post).toHaveBeenCalledWith(
        KLING_URL,
        { prompt: 'phase2 prompt', image_url: 'https://cdn.example/base.png', duration: 10, aspect_ratio: '9:16' },
        expect.any(Object)
      );
    });

    it('prefers phases.phase2.imageUrl over theme.baseImageUrl when set', async () => {
      const themeWithOverride = {
        ...mockTheme,
        phases: {
          ...mockTheme.phases,
          phase2: { ...mockTheme.phases.phase2, imageUrl: 'https://cdn.example/phase2-start.png' },
        },
      };
      const gen = new VideoGenerator(themeWithOverride);

      axios.post.mockResolvedValueOnce({ data: { request_id: 'muapi-req-6' } });
      axios.get.mockResolvedValueOnce({
        data: { status: 'completed', outputs: ['https://cdn.example/phase2.mp4'] },
      });

      await gen.generatePhase2();

      expect(axios.post).toHaveBeenCalledWith(
        KLING_URL,
        expect.objectContaining({ image_url: 'https://cdn.example/phase2-start.png' }),
        expect.any(Object)
      );
    });

    it('throws a wrapped error when muapi.ai reports failed', async () => {
      axios.post.mockResolvedValueOnce({ data: { request_id: 'muapi-req-7' } });
      axios.get.mockResolvedValueOnce({ data: { status: 'failed', error: 'bad input' } });

      await expect(generator.generatePhase2()).rejects.toThrow(
        'Phase 2 generation failed: muapi.ai task failed: bad input'
      );
    });
  });

  describe('generatePhase2 — Tier B (free ffmpeg last-frame chaining)', () => {
    it('chains from phase1Result\'s actual last frame', async () => {
      config.continuity.tier = 'B';

      axios.post.mockResolvedValueOnce({ data: { request_id: 'muapi-p1' } });
      axios.get
        .mockResolvedValueOnce({ data: { status: 'completed', outputs: ['https://cdn.example/phase1.mp4'] } })
        .mockResolvedValueOnce({ data: Buffer.from('fake-video-bytes') }) // downloadRemoteFile
        .mockResolvedValueOnce({ data: { status: 'completed', outputs: ['https://cdn.example/phase2-b.mp4'] } });
      axios.post.mockResolvedValueOnce({ data: { request_id: 'muapi-p2' } });

      await generator.generatePhase1();
      const result = await generator.generatePhase2();

      const storage = require('../../src/utils/storage');
      expect(ffmpegHelpers.extractLastFrame).toHaveBeenCalled();
      expect(storage.uploadFile).toHaveBeenCalled();
      expect(axios.post).toHaveBeenLastCalledWith(
        KLING_URL,
        expect.objectContaining({ image_url: 'https://cdn.example/uploaded_frame.png' }),
        expect.any(Object)
      );
      expect(result).toEqual({
        url: 'https://cdn.example/phase2-b.mp4',
        taskId: 'muapi-p2',
        provider: 'muapiKling',
        tier: 'B',
        costUsd: 0.45,
      });
    });

    it('throws if phase1Result has not been generated yet', async () => {
      config.continuity.tier = 'B';
      await expect(generator.generatePhase2()).rejects.toThrow(
        /Tier B Phase 2 requires a completed phase1Result/
      );
    });
  });

  describe('generatePhase2 — Tier C (Runway Gen-4 Aleph video-to-video via muapi.ai)', () => {
    it('transforms phase1\'s real rendered clip and returns a flat $0.90 cost', async () => {
      config.continuity.tier = 'C';

      axios.post.mockResolvedValueOnce({ data: { request_id: 'muapi-p1' } });
      axios.get.mockResolvedValueOnce({
        data: { status: 'completed', outputs: ['https://cdn.example/phase1.mp4'] },
      });
      await generator.generatePhase1();

      axios.post.mockResolvedValueOnce({ data: { request_id: 'aleph-1' } });
      axios.get.mockResolvedValueOnce({
        data: { status: 'completed', outputs: ['https://cdn.example/phase2-aleph.mp4'] },
      });

      const result = await generator.generatePhase2();

      expect(costTracker.checkBudgetCircuitBreaker).toHaveBeenCalledWith(0.90);
      expect(axios.post).toHaveBeenLastCalledWith(
        ALEPH_URL,
        { prompt: 'phase2 prompt', video_url: 'https://cdn.example/phase1.mp4', aspect_ratio: '9:16' },
        expect.any(Object)
      );
      expect(result).toEqual({
        url: 'https://cdn.example/phase2-aleph.mp4',
        taskId: 'aleph-1',
        provider: 'aleph',
        tier: 'C',
        costUsd: 0.90,
      });
    });

    it('falls back to Tier B when the budget circuit breaker trips', async () => {
      config.continuity.tier = 'C';

      axios.post.mockResolvedValueOnce({ data: { request_id: 'muapi-p1' } });
      axios.get.mockResolvedValueOnce({
        data: { status: 'completed', outputs: ['https://cdn.example/phase1.mp4'] },
      });
      await generator.generatePhase1();

      costTracker.checkBudgetCircuitBreaker.mockResolvedValue({
        allowed: false, monthSpend: 49, projected: 49.9, cap: 50,
      });

      axios.post.mockResolvedValueOnce({ data: { request_id: 'muapi-p2' } });
      axios.get
        .mockResolvedValueOnce({ data: Buffer.from('fake-video-bytes') }) // downloadRemoteFile
        .mockResolvedValueOnce({ data: { status: 'completed', outputs: ['https://cdn.example/phase2-fallback.mp4'] } });

      const result = await generator.generatePhase2();

      expect(result.tier).toBe('B');
      expect(result.fallbackFrom).toBe('aleph');
      expect(result.fallbackReason).toMatch(/Budget circuit breaker tripped/);
      expect(result.url).toBe('https://cdn.example/phase2-fallback.mp4');
    });

    it('throws (no fallback) when fallbackEnabled is false', async () => {
      config.continuity.tier = 'C';
      config.continuity.fallbackEnabled = false;

      axios.post.mockResolvedValueOnce({ data: { request_id: 'muapi-p1' } });
      axios.get.mockResolvedValueOnce({
        data: { status: 'completed', outputs: ['https://cdn.example/phase1.mp4'] },
      });
      await generator.generatePhase1();

      costTracker.checkBudgetCircuitBreaker.mockResolvedValue({
        allowed: false, monthSpend: 49, projected: 49.9, cap: 50,
      });

      await expect(generator.generatePhase2()).rejects.toThrow(
        /Budget circuit breaker tripped/
      );
    });
  });

  describe('transformPhase2WithAleph', () => {
    it('requires a phase1 video url', async () => {
      await expect(generator.transformPhase2WithAleph()).rejects.toThrow(
        /requires phase1Result\.url/
      );
    });
  });

  describe('klingCostFor', () => {
    it('scales the per-call estimate by duration/5', () => {
      expect(generator.klingCostFor('phase1')).toBe(0.225); // 5s phase
      expect(generator.klingCostFor('phase2')).toBe(0.45); // 10s phase
    });
  });

  describe('generatePhase3', () => {
    it('Tier A: submits an independent call when phase2 was also Tier A', async () => {
      generator.phase2Result = { tier: 'A' };
      axios.post.mockResolvedValueOnce({ data: { request_id: 'muapi-p3' } });
      axios.get.mockResolvedValueOnce({
        data: { status: 'completed', outputs: ['https://cdn.example/phase3.mp4'] },
      });

      const result = await generator.generatePhase3();

      expect(result).toEqual({
        url: 'https://cdn.example/phase3.mp4',
        taskId: 'muapi-p3',
        provider: 'muapiKling',
        tier: 'A',
        costUsd: 0.225,
      });
    });

    it('throws when phase2Result has not been generated yet (non-Tier-A path)', async () => {
      config.continuity.tier = 'B';
      await expect(generator.generatePhase3()).rejects.toThrow(
        /Phase 3 requires a completed phase2Result/
      );
    });

    it('chains from phase2Result\'s real last frame for Tier B', async () => {
      config.continuity.tier = 'B';
      generator.phase2Result = { url: 'https://cdn.example/phase2.mp4', tier: 'B' };

      axios.post.mockResolvedValueOnce({ data: { request_id: 'muapi-p3b' } });
      axios.get
        .mockResolvedValueOnce({ data: Buffer.from('fake-video-bytes') }) // downloadRemoteFile
        .mockResolvedValueOnce({ data: { status: 'completed', outputs: ['https://cdn.example/phase3-b.mp4'] } });

      const result = await generator.generatePhase3();

      expect(result.tier).toBe('B');
      expect(result.url).toBe('https://cdn.example/phase3-b.mp4');
    });

    it('keeps Tier C when chaining from an Aleph-derived phase2Result', async () => {
      config.continuity.tier = 'C';
      generator.phase2Result = { url: 'https://cdn.example/phase2-aleph.mp4', tier: 'C' };

      axios.post.mockResolvedValueOnce({ data: { request_id: 'muapi-p3c' } });
      axios.get
        .mockResolvedValueOnce({ data: Buffer.from('fake-video-bytes') }) // downloadRemoteFile
        .mockResolvedValueOnce({ data: { status: 'completed', outputs: ['https://cdn.example/phase3-c.mp4'] } });

      const result = await generator.generatePhase3();

      expect(result.tier).toBe('C');
    });
  });

  describe('upscaleVideo (Replicate — optional 4K upscale only, unaffected by the muapi.ai migration)', () => {
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
