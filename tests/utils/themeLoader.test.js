// tests/utils/themeLoader.test.js
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

const mockFs = {
  existsSync: jest.fn(),
  readdirSync: jest.fn(),
  readJsonSync: jest.fn(),
};
jest.mock('fs-extra', () => mockFs, { virtual: true });

const path = require('path');
const {
  loadTheme,
  listThemes,
  resolveThemePath,
  validateTheme,
  THEMES_DIR,
} = require('../../src/utils/themeLoader');
const mockTheme = require('../fixtures/mockTheme');

describe('listThemes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns [] when the themes directory does not exist', () => {
    mockFs.existsSync.mockReturnValue(false);
    expect(listThemes()).toEqual([]);
  });

  it('lists .json files minus extension, sorted, excluding underscore-prefixed files', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readdirSync.mockReturnValue([
      'zzz-theme.json',
      'aaa-theme.json',
      '_template.json',
      'README.md',
      'notes.txt',
    ]);
    expect(listThemes()).toEqual(['aaa-theme', 'zzz-theme']);
  });
});

describe('resolveThemePath', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns null for a falsy input', () => {
    expect(resolveThemePath(undefined)).toBeNull();
  });

  it('resolves a bare theme id to <THEMES_DIR>/<id>.json', () => {
    expect(resolveThemePath('my-theme')).toBe(path.join(THEMES_DIR, 'my-theme.json'));
  });

  it('resolves an explicit path containing a slash as-is', () => {
    const result = resolveThemePath('./custom/my-theme.json');
    expect(result).toBe(path.resolve('./custom/my-theme.json'));
  });
});

describe('validateTheme', () => {
  it('accepts a fully-formed theme', () => {
    expect(() => validateTheme(mockTheme, 'mock-theme.json')).not.toThrow();
  });

  it('throws when a required top-level field is missing', () => {
    const broken = { ...mockTheme };
    delete broken.baseImageUrl;
    expect(() => validateTheme(broken, 'mock-theme.json')).toThrow(
      /missing required field\(s\): baseImageUrl/
    );
  });

  it('throws when a phase is missing a prompt', () => {
    const broken = JSON.parse(JSON.stringify(mockTheme));
    delete broken.phases.phase2.prompt;
    expect(() => validateTheme(broken, 'mock-theme.json')).toThrow(
      /phases\.phase2 is missing a "prompt"/
    );
  });

  it('throws when a phase is missing a duration', () => {
    const broken = JSON.parse(JSON.stringify(mockTheme));
    delete broken.phases.phase1.duration;
    expect(() => validateTheme(broken, 'mock-theme.json')).toThrow(
      /phases\.phase1 is missing a "duration"/
    );
  });

  it('throws when an audio layer is missing a prompt', () => {
    const broken = JSON.parse(JSON.stringify(mockTheme));
    delete broken.audio.music.prompt;
    expect(() => validateTheme(broken, 'mock-theme.json')).toThrow(
      /audio\.music is missing a "prompt"/
    );
  });

  it('throws when overlay has neither primaryText nor secondaryText', () => {
    const broken = JSON.parse(JSON.stringify(mockTheme));
    broken.overlay.primaryText = '';
    broken.overlay.secondaryText = '';
    expect(() => validateTheme(broken, 'mock-theme.json')).toThrow(
      /overlay must define at least primaryText or secondaryText/
    );
  });

  it('throws when platforms.youtube is missing', () => {
    const broken = JSON.parse(JSON.stringify(mockTheme));
    delete broken.platforms.youtube;
    expect(() => validateTheme(broken, 'mock-theme.json')).toThrow(
      /missing a "youtube" entry/
    );
  });
});

describe('loadTheme', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.BASE_IMAGE_URL_OVERRIDE;
  });

  it('throws a helpful error listing available themes when no theme id is given', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readdirSync.mockReturnValue(['mock-theme.json', 'other-theme.json']);

    expect(() => loadTheme()).toThrow(/No theme specified.*mock-theme, other-theme/);
  });

  it('throws when the resolved theme file does not exist', () => {
    mockFs.existsSync.mockReturnValue(false);
    mockFs.readdirSync.mockReturnValue([]);

    expect(() => loadTheme('missing-theme')).toThrow(
      /Theme not found: "missing-theme".*\(none found in themes\/\)/
    );
  });

  it('loads, parses, and validates a theme file', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readJsonSync.mockReturnValue(mockTheme);

    const theme = loadTheme('mock-theme');

    expect(theme.id).toBe(mockTheme.id);
    expect(theme.baseImageUrl).toBe(mockTheme.baseImageUrl);
  });

  it('throws a descriptive error when the theme JSON fails to parse', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readJsonSync.mockImplementation(() => {
      throw new Error('Unexpected token in JSON');
    });

    expect(() => loadTheme('broken-theme')).toThrow(/Failed to parse theme JSON/);
  });

  it('surfaces the validateTheme error for a malformed theme file', () => {
    mockFs.existsSync.mockReturnValue(true);
    const broken = JSON.parse(JSON.stringify(mockTheme));
    delete broken.overlay;
    mockFs.readJsonSync.mockReturnValue(broken);

    expect(() => loadTheme('broken-theme')).toThrow(/missing required field\(s\): overlay/);
  });

  it('applies BASE_IMAGE_URL_OVERRIDE when set, without mutating the source object', () => {
    process.env.BASE_IMAGE_URL_OVERRIDE = 'https://staging.example/override.png';
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readJsonSync.mockReturnValue(mockTheme);

    const theme = loadTheme('mock-theme');

    expect(theme.baseImageUrl).toBe('https://staging.example/override.png');
    expect(mockTheme.baseImageUrl).toBe('https://cdn.example/base.png');

    delete process.env.BASE_IMAGE_URL_OVERRIDE;
  });
});
