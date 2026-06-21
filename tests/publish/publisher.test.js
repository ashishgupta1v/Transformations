// tests/publish/publisher.test.js
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('axios', () => ({
  post: jest.fn(),
  get: jest.fn(),
}), { virtual: true });

jest.mock('fs-extra', () => ({
  createReadStream: jest.fn((p) => `STREAM(${p})`),
  pathExists: jest.fn().mockResolvedValue(false),
}), { virtual: true });

jest.mock('../../src/utils/retry', () => ({
  withRetry: jest.fn((fn) => fn()),
  sleep: jest.fn(() => Promise.resolve()),
}));

jest.mock('../../src/utils/storage', () => ({
  uploadFile: jest.fn().mockResolvedValue({ url: 'https://storage.example/ig.mp4' }),
}));

jest.mock('../../src/utils/youtubeAuth', () => ({
  getAuthenticatedClient: jest.fn(() => ({ mockAuth: true })),
}));

// publisher.js's notifyWhatsAppStatus calls whatsapp.notifyLive({theme, path}),
// not sendText directly — notifyLive is the theme-aware entry point.
jest.mock('../../src/notify/whatsapp', () => ({
  notifyLive: jest.fn().mockResolvedValue({}),
}));

// publishFromOutput() checks config.platforms for filenames (engine-level).
jest.mock('../../config/pipeline.config', () => ({
  platforms: {
    youtube: { filename: 'youtube_1080.mp4' },
    shorts: { filename: 'shorts_1080x1920.mp4' },
  },
}));

const mockYoutubeInsert = jest.fn();
jest.mock(
  'googleapis',
  () => ({
    google: {
      youtube: jest.fn(() => ({ videos: { insert: (...args) => mockYoutubeInsert(...args) } })),
    },
  }),
  { virtual: true }
);

const mockUploadMedia = jest.fn();
const mockTweet = jest.fn();
jest.mock(
  'twitter-api-v2',
  () => ({
    TwitterApi: jest.fn().mockImplementation(() => ({
      v1: { uploadMedia: (...args) => mockUploadMedia(...args) },
      v2: { tweet: (...args) => mockTweet(...args) },
    })),
  }),
  { virtual: true }
);

jest.mock(
  'form-data',
  () =>
    jest.fn().mockImplementation(() => ({
      append: jest.fn(),
      getHeaders: jest.fn(() => ({ 'content-type': 'multipart/form-data' })),
    })),
  { virtual: true }
);

const axios = require('axios');
const fs = require('fs-extra');
const whatsapp = require('../../src/notify/whatsapp');
const storage = require('../../src/utils/storage');
const Publisher = require('../../src/publish/publisher');
const mockTheme = require('../fixtures/mockTheme');

describe('Publisher', () => {
  let publisher;

  beforeEach(() => {
    jest.clearAllMocks();
    fs.pathExists.mockResolvedValue(false);
    publisher = new Publisher(mockTheme);
  });

  describe('constructor / requireTheme guard', () => {
    it('rejects when no theme was injected', async () => {
      const bare = new Publisher();
      await expect(bare.publishYouTube({ path: './output/youtube_1080.mp4' })).rejects.toThrow(
        /Publisher requires a theme/
      );
    });
  });

  describe('publishYouTube', () => {
    it('uploads the export file and returns the watch url', async () => {
      mockYoutubeInsert.mockResolvedValueOnce({ data: { id: 'vid123' } });

      const result = await publisher.publishYouTube({ path: './output/youtube_1080.mp4' });

      expect(result).toEqual({ videoId: 'vid123', url: 'https://youtube.com/watch?v=vid123' });
      expect(fs.createReadStream).toHaveBeenCalledWith('./output/youtube_1080.mp4');
      expect(mockYoutubeInsert).toHaveBeenCalledWith(
        expect.objectContaining({
          part: ['snippet', 'status'],
          requestBody: expect.objectContaining({
            snippet: expect.objectContaining({
              title: 'YT Title',
              description: 'YT Description',
              // defaultLanguage is theme-driven (platforms.youtube.defaultLanguage,
              // falling back to theme.language) — not hardcoded to any one locale.
              defaultLanguage: 'en',
            }),
            status: expect.objectContaining({ selfDeclaredMadeForKids: false }),
          }),
        })
      );
    });

    it('throws when no export file is provided', async () => {
      await expect(publisher.publishYouTube(undefined)).rejects.toThrow('No YouTube export file');
      expect(mockYoutubeInsert).not.toHaveBeenCalled();
    });
  });

  describe('publishYouTubeShorts', () => {
    it('uploads and returns the shorts url', async () => {
      mockYoutubeInsert.mockResolvedValueOnce({ data: { id: 'short456' } });

      const result = await publisher.publishYouTubeShorts({ path: './output/shorts_1080x1920.mp4' });

      expect(result).toEqual({ videoId: 'short456', url: 'https://youtube.com/shorts/short456' });
    });

    it('throws when no export file is provided', async () => {
      await expect(publisher.publishYouTubeShorts(undefined)).rejects.toThrow('No Shorts export file');
    });
  });

  describe('publishTwitter', () => {
    it('uploads media then posts the tweet referencing that media id', async () => {
      mockUploadMedia.mockResolvedValueOnce('media-id-1');
      mockTweet.mockResolvedValueOnce({ data: { id: 'tweet-id-1' } });

      const result = await publisher.publishTwitter({ path: './output/twitter_1080.mp4' });

      expect(mockUploadMedia).toHaveBeenCalledWith('./output/twitter_1080.mp4', { mimeType: 'video/mp4' });
      expect(mockTweet).toHaveBeenCalledWith(
        expect.objectContaining({ media: { media_ids: ['media-id-1'] } })
      );
      expect(result).toEqual({ id: 'tweet-id-1' });
    });

    it('throws when no export file is provided', async () => {
      await expect(publisher.publishTwitter(undefined)).rejects.toThrow('No Twitter export file');
    });
  });

  describe('publishFacebook', () => {
    it('posts the video file to the page videos endpoint', async () => {
      axios.post.mockResolvedValueOnce({ data: { id: 'fb-post-1' } });

      const result = await publisher.publishFacebook({ path: './output/facebook_1080.mp4' });

      expect(result).toEqual({ id: 'fb-post-1' });
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining('/videos'),
        expect.anything(),
        expect.any(Object)
      );
    });

    it('throws when no export file is provided', async () => {
      await expect(publisher.publishFacebook(undefined)).rejects.toThrow('No Facebook export file');
    });
  });

  describe('notifyWhatsAppStatus', () => {
    it('delegates to whatsapp.notifyLive with the theme and export path', async () => {
      const result = await publisher.notifyWhatsAppStatus({ path: './output/whatsapp_720.mp4' });

      expect(result).toEqual({ notified: true });
      expect(whatsapp.notifyLive).toHaveBeenCalledWith({
        theme: mockTheme,
        path: './output/whatsapp_720.mp4',
      });
    });

    it('skips silently when no export file is provided', async () => {
      const result = await publisher.notifyWhatsAppStatus(undefined);

      expect(result).toEqual({ skipped: true });
      expect(whatsapp.notifyLive).not.toHaveBeenCalled();
    });
  });

  describe('publishInstagram', () => {
    it('uploads to storage, creates a container, waits for it, then publishes', async () => {
      axios.post
        .mockResolvedValueOnce({ data: { id: 'container-1' } }) // media create
        .mockResolvedValueOnce({ data: { id: 'publish-1' } }); // media_publish
      axios.get.mockResolvedValueOnce({ data: { status_code: 'FINISHED' } });

      const result = await publisher.publishInstagram({ path: './output/ig_reel_1080.mp4' });

      expect(storage.uploadFile).toHaveBeenCalledWith('./output/ig_reel_1080.mp4', 'instagram');
      expect(result).toEqual({ id: 'publish-1' });
    });

    it('throws when no export file is provided', async () => {
      await expect(publisher.publishInstagram(undefined)).rejects.toThrow('No Instagram export file');
    });
  });

  describe('publishAll', () => {
    it('maps fulfilled and rejected platform results into a single output object', async () => {
      jest.spyOn(publisher, 'publishYouTube').mockResolvedValue({ videoId: 'v1', url: 'https://youtube.com/watch?v=v1' });
      jest.spyOn(publisher, 'publishInstagram').mockRejectedValue(new Error('No Instagram export file'));
      jest.spyOn(publisher, 'publishYouTubeShorts').mockResolvedValue({ videoId: 's1', url: 'https://youtube.com/shorts/s1' });
      jest.spyOn(publisher, 'publishTwitter').mockResolvedValue({ id: 't1' });
      jest.spyOn(publisher, 'publishFacebook').mockRejectedValue(new Error('No Facebook export file'));
      jest.spyOn(publisher, 'notifyWhatsAppStatus').mockResolvedValue({ notified: true });

      const output = await publisher.publishAll({
        youtube: { path: 'a' },
        instagramReel: undefined,
        shorts: { path: 'b' },
        twitter: { path: 'c' },
        facebook: undefined,
        whatsapp: { path: 'd' },
      });

      expect(output.youtube).toEqual({ success: true, videoId: 'v1', url: 'https://youtube.com/watch?v=v1' });
      expect(output.instagram).toEqual({ success: false, error: 'No Instagram export file' });
      expect(output.shorts).toEqual({ success: true, videoId: 's1', url: 'https://youtube.com/shorts/s1' });
      expect(output.twitter).toEqual({ success: true, id: 't1' });
      expect(output.facebook).toEqual({ success: false, error: 'No Facebook export file' });
      expect(output.whatsapp).toEqual({ success: true, notified: true });
    });
  });

  describe('publishFromOutput', () => {
    it('only includes platforms whose export file exists on disk, then delegates to publishAll', async () => {
      fs.pathExists.mockImplementation((p) => Promise.resolve(p.includes('youtube_1080.mp4')));
      const publishAllSpy = jest.spyOn(publisher, 'publishAll').mockResolvedValue({ ok: true });

      await publisher.publishFromOutput();

      const [exportsArg] = publishAllSpy.mock.calls[0];
      expect(exportsArg.youtube).toEqual(expect.objectContaining({ path: expect.stringContaining('youtube_1080.mp4') }));
      expect(exportsArg.shorts).toBeUndefined();
    });
  });
});
