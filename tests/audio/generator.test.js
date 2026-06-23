// tests/audio/generator.test.js
// PROVIDER NOTE (2026-06): generateMusicScore rewritten for the muapi.ai
// migration — music generation moved from the unofficial Suno-reseller
// (apipass.app) to muapi.ai's suno-create-music model, using the same
// submit/poll contract as src/video/generator.js (POST /api/v1/{model},
// GET /api/v1/predictions/{id}/result). ElevenLabs sound-generation tests
// (ambient/transformation) call fal-ai's text-to-sound model.

jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('fs-extra', () => ({
  ensureDirSync: jest.fn(),
  writeFile: jest.fn().mockResolvedValue(),
}), { virtual: true });

jest.mock('axios', () => ({
  post: jest.fn(),
  get: jest.fn(),
}), { virtual: true });

jest.mock('../../src/utils/retry', () => ({
  withRetry: jest.fn((fn) => fn()),
  sleep: jest.fn(() => Promise.resolve()),
}));

// audio content (prompts/volumes) is theme content now — config only
// carries engine-level polling settings.
jest.mock('../../config/pipeline.config', () => ({
  polling: { intervalMs: 1, maxAttempts: 3 },
}));

const axios = require('axios');
const fs = require('fs-extra');
const config = require('../../config/pipeline.config');
const AudioGenerator = require('../../src/audio/generator');
const mockTheme = require('../fixtures/mockTheme');

const MUAPI_BASE_URL = 'https://api.muapi.ai/api/v1';
const SUNO_MODEL = 'suno-create-music';
const SUNO_URL = `${MUAPI_BASE_URL}/${SUNO_MODEL}`;

beforeEach(() => {
  process.env.MUAPI_API_KEY = 'test-muapi-key';
  process.env.FAL_API_KEY = 'test-fal-key:secret'; // set dummy key to execute real code path
  delete process.env.MUAPI_BASE_URL;
});

describe('AudioGenerator', () => {
  let generator;

  beforeEach(() => {
    jest.clearAllMocks();
    config.polling.maxAttempts = 3;
    generator = new AudioGenerator(mockTheme);
  });

  describe('constructor / requireTheme guard', () => {
    it('rejects when no theme was injected', async () => {
      const bare = new AudioGenerator();
      await expect(bare.generateAmbientAudio()).rejects.toThrow(
        /AudioGenerator requires a theme/
      );
    });
  });

  describe('generateAmbientAudio', () => {
    it('posts to ElevenLabs sound-generation and writes the mp3 locally', async () => {
      const fakeBytes = Buffer.from('fake-mp3-bytes');
      axios.post.mockResolvedValueOnce({ data: { audio_url: 'https://cdn.example/ambient.mp3' } });
      axios.get.mockResolvedValueOnce({ data: fakeBytes });

      const result = await generator.generateAmbientAudio();

      expect(axios.post).toHaveBeenCalledWith(
        'https://fal.run/fal-ai/elevenlabs/text-to-sound',
        expect.objectContaining({ prompt: 'ambient prompt', duration: 15 }),
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Key test-fal-key:secret' }) })
      );
      expect(axios.get).toHaveBeenCalledWith('https://cdn.example/ambient.mp3', { responseType: 'arraybuffer' });
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('ambient_audio.mp3'),
        fakeBytes
      );
      expect(result.path).toContain('ambient_audio.mp3');
      expect(result.url).toBe(`file://${result.path}`);
    });
  });

  describe('generateTransformationAudio', () => {
    it('uses the transformation layer prompt and duration', async () => {
      axios.post.mockResolvedValueOnce({ data: { url: 'https://cdn.example/transform.mp3' } });
      axios.get.mockResolvedValueOnce({ data: Buffer.from('bytes') });

      await generator.generateTransformationAudio();

      expect(axios.post).toHaveBeenCalledWith(
        'https://fal.run/fal-ai/elevenlabs/text-to-sound',
        expect.objectContaining({ prompt: 'transformation prompt', duration: 15 }),
        expect.any(Object)
      );
    });
  });

  it('wraps ElevenLabs failures with a labeled error message', async () => {
    axios.post.mockRejectedValueOnce(new Error('ElevenLabs quota exceeded'));

    await expect(generator.generateAmbientAudio()).rejects.toThrow(
      'ambient audio generation failed: ElevenLabs quota exceeded'
    );
  });

  describe('generateMusicScore (muapi.ai Suno)', () => {
    it('maps theme.audio.music.prompt onto muapi\'s style field and polls until completed', async () => {
      axios.post.mockResolvedValueOnce({ data: { request_id: 'suno-pred-1' } });
      axios.get.mockResolvedValueOnce({
        data: { status: 'completed', outputs: ['https://cdn.example/score.mp3'] },
      });

      const result = await generator.generateMusicScore();

      expect(result).toEqual({ url: 'https://cdn.example/score.mp3', taskId: 'suno-pred-1' });
      expect(axios.post).toHaveBeenCalledWith(
        SUNO_URL,
        { style: 'music prompt', instrumental: true },
        expect.objectContaining({
          headers: expect.objectContaining({ 'x-api-key': 'test-muapi-key' }),
        })
      );
    });

    it('defaults instrumental to true when the theme omits it', async () => {
      const themeNoInstrumental = {
        ...mockTheme,
        audio: {
          ...mockTheme.audio,
          music: { ...mockTheme.audio.music, instrumental: undefined },
        },
      };
      const gen = new AudioGenerator(themeNoInstrumental);

      axios.post.mockResolvedValueOnce({ data: { request_id: 'suno-pred-2' } });
      axios.get.mockResolvedValueOnce({
        data: { status: 'completed', outputs: ['https://cdn.example/score2.mp3'] },
      });

      await gen.generateMusicScore();

      expect(axios.post).toHaveBeenCalledWith(
        SUNO_URL,
        expect.objectContaining({ instrumental: true }),
        expect.any(Object)
      );
    });

    it('throws a wrapped error when muapi.ai reports the task failed', async () => {
      axios.post.mockResolvedValueOnce({ data: { request_id: 'suno-pred-3' } });
      axios.get.mockResolvedValueOnce({ data: { status: 'failed', error: 'generation error' } });

      await expect(generator.generateMusicScore()).rejects.toThrow(
        'Music score generation failed: muapi.ai Suno generation failed: generation error'
      );
    });

    it('times out after exhausting all polling attempts', async () => {
      axios.post.mockResolvedValueOnce({ data: { request_id: 'suno-pred-4' } });
      axios.get.mockResolvedValue({ data: { status: 'processing' } });

      await expect(generator.generateMusicScore()).rejects.toThrow(
        'Music score generation failed: muapi.ai polling timeout'
      );
      expect(axios.get).toHaveBeenCalledTimes(3);
    });

    it('throws a wrapped error when the muapi.ai submit response has no request_id/id', async () => {
      axios.post.mockResolvedValueOnce({ data: {} });
      await expect(generator.generateMusicScore()).rejects.toThrow(
        /Music score generation failed:/
      );
    });
  });
});
