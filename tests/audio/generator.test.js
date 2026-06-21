// tests/audio/generator.test.js
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
      axios.post.mockResolvedValueOnce({ data: fakeBytes });

      const result = await generator.generateAmbientAudio();

      expect(axios.post).toHaveBeenCalledWith(
        'https://api.elevenlabs.io/v1/sound-generation',
        expect.objectContaining({ text: 'ambient prompt', duration_seconds: 15, prompt_influence: 0.3 }),
        expect.objectContaining({ responseType: 'arraybuffer' })
      );
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('ambient_audio.mp3'),
        fakeBytes
      );
      expect(result.path).toContain('ambient_audio.mp3');
      expect(result.url).toBe(`file://${result.path}`);
    });
  });

  describe('generateTransformationAudio', () => {
    it('uses the transformation layer prompt and prompt_influence', async () => {
      axios.post.mockResolvedValueOnce({ data: Buffer.from('bytes') });

      await generator.generateTransformationAudio();

      expect(axios.post).toHaveBeenCalledWith(
        'https://api.elevenlabs.io/v1/sound-generation',
        expect.objectContaining({ text: 'transformation prompt', prompt_influence: 0.5 }),
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

  describe('generateMusicScore (Suno)', () => {
    it('submits to Suno and polls until the track is ready', async () => {
      axios.post.mockResolvedValueOnce({ data: { data: { task_id: 'suno-task-1' } } });
      axios.get.mockResolvedValueOnce({
        data: {
          data: {
            status: 'SUCCESS',
            response: { sunoData: [{ audio_url: 'https://cdn.example/score.mp3' }] },
          },
        },
      });

      const result = await generator.generateMusicScore();

      expect(result).toEqual({ url: 'https://cdn.example/score.mp3', taskId: 'suno-task-1' });
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining('/api/v1/generate'),
        expect.objectContaining({ prompt: 'music prompt', instrumental: true }),
        expect.any(Object)
      );
    });

    it('throws when Suno reports an error status', async () => {
      axios.post.mockResolvedValueOnce({ data: { data: { task_id: 'suno-task-2' } } });
      axios.get.mockResolvedValueOnce({ data: { data: { status: 'error' } } });

      await expect(generator.generateMusicScore()).rejects.toThrow(
        'Music score generation failed: Suno generation failed'
      );
    });

    it('times out after exhausting all polling attempts', async () => {
      axios.post.mockResolvedValueOnce({ data: { data: { task_id: 'suno-task-3' } } });
      axios.get.mockResolvedValue({ data: { data: { status: 'PENDING' } } });

      await expect(generator.generateMusicScore()).rejects.toThrow(
        'Music score generation failed: Suno polling timeout'
      );
      expect(axios.get).toHaveBeenCalledTimes(3);
    });
  });
});
