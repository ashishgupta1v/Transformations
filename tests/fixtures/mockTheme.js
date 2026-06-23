// tests/fixtures/mockTheme.js
// Shared, schema-valid theme fixture for unit tests. Mirrors the shape
// enforced by src/utils/themeLoader.js#validateTheme (see themes/_template.json
// for the authoritative field reference) so every module's tests exercise
// real theme-injection rather than ad-hoc partial objects. Subject-neutral
// on purpose — this is a generic "product" theme, not Jagannatha-specific,
// to make sure tests don't accidentally re-couple to one subject.

module.exports = {
  id: 'test-theme',
  displayName: 'Test Theme',
  subjectType: 'product',
  language: 'en',
  tagline: 'Test tagline',
  author: 'Test Author',
  bannerTitle: 'TEST THEME',
  baseImageUrl: 'https://cdn.example/base.png',

  phases: {
    phase1: {
      name: 'Phase 1',
      duration: 5,
      provider: 'fal',
      prompt: 'phase1 prompt',
      negativePrompt: 'phase1 negative',
    },
    phase2: {
      name: 'Phase 2',
      duration: 10,
      provider: 'fal',
      prompt: 'phase2 prompt',
      negativePrompt: 'phase2 negative',
    },
    phase3: {
      name: 'Phase 3',
      duration: 5,
      provider: 'fal',
      prompt: 'phase3 prompt',
      negativePrompt: 'phase3 negative',
    },
  },

  audio: {
    ambient: {
      name: 'Ambient',
      prompt: 'ambient prompt',
      duration: 15,
      volume: 1.0,
      promptInfluence: 0.3,
    },
    transformation: {
      name: 'Transformation',
      prompt: 'transformation prompt',
      duration: 15,
      volume: 0.85,
      promptInfluence: 0.5,
    },
    music: {
      name: 'Score',
      prompt: 'music prompt',
      duration: 15,
      volume: 0.65,
      instrumental: true,
    },
  },

  overlay: {
    primaryText: 'PRIMARY TEXT',
    secondaryText: 'SECONDARY TEXT',
    startTime: 13,
    endTime: 15,
    fadeIn: 0.5,
    fadeOut: 0.5,
  },

  platforms: {
    youtube: {
      title: 'YT Title',
      description: 'YT Description',
      tags: ['tag1'],
      categoryId: '22',
      privacy: 'public',
      defaultLanguage: 'en',
    },
    shorts: {
      title: 'Shorts Title',
      description: 'Shorts Description',
      tags: ['Shorts'],
      categoryId: '22',
      privacy: 'public',
    },
    instagramReel: { caption: 'IG Caption' },
    twitter: { text: 'Tweet text' },
    facebook: { description: 'FB description' },
    whatsapp: { liveText: 'New {displayName} video is live!' },
  },

  notifications: {
    whatsappComplete: '✅ {displayName} complete',
    whatsappError: '❌ {displayName} failed: {error}',
    whatsappLive: 'New {displayName} video is live!\n\nFile ready: {path}',
  },
};
