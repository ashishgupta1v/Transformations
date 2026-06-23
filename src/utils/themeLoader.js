// src/utils/themeLoader.js
// Loads a "theme" — the subject-specific content for a pipeline run (prompts,
// audio cues, overlay text, per-platform copy, branding). Themes live as JSON
// files under themes/ so this pipeline can run for any deity, location,
// product, or business without touching engine code in config/ or src/.

const fs = require('fs-extra');
const path = require('path');
const logger = require('./logger');

const THEMES_DIR = path.join(__dirname, '..', '..', 'themes');

const REQUIRED_TOP_LEVEL = ['id', 'displayName', 'baseImageUrl', 'phases', 'audio', 'overlay', 'platforms'];
const REQUIRED_PHASES = ['phase1', 'phase2', 'phase3'];
const REQUIRED_AUDIO_LAYERS = ['ambient', 'transformation', 'music'];

/**
 * List available theme ids (filenames under themes/, minus .json, minus any
 * file prefixed with "_" such as _template.json).
 */
function listThemes() {
  if (!fs.existsSync(THEMES_DIR)) return [];
  return fs
    .readdirSync(THEMES_DIR)
    .filter((file) => file.endsWith('.json') && !file.startsWith('_'))
    .map((file) => file.replace(/\.json$/, ''))
    .sort();
}

/**
 * Resolve a theme id (e.g. "jagannatha-rathyatra") or an explicit path
 * (e.g. "./my-themes/foo.json") to an absolute file path.
 */
function resolveThemePath(themeIdOrPath) {
  if (!themeIdOrPath) return null;
  const looksLikePath =
    themeIdOrPath.endsWith('.json') &&
    (themeIdOrPath.includes('/') || themeIdOrPath.includes('\\') || fs.existsSync(themeIdOrPath));
  if (looksLikePath) {
    return path.resolve(themeIdOrPath);
  }
  return path.join(THEMES_DIR, `${themeIdOrPath}.json`);
}

function describeAvailable() {
  const available = listThemes();
  return available.length ? available.join(', ') : '(none found in themes/)';
}

/**
 * Validate that a parsed theme has the minimum shape every pipeline module
 * depends on. Throws a descriptive error rather than letting a malformed
 * theme fail deep inside a provider call.
 */
function validateTheme(theme, sourcePath) {
  const missingTop = REQUIRED_TOP_LEVEL.filter((key) => theme[key] === undefined || theme[key] === null);
  if (missingTop.length) {
    throw new Error(`Theme "${sourcePath}" is missing required field(s): ${missingTop.join(', ')}`);
  }

  const isSingleShot = theme.id?.endsWith('-10s') || sourcePath.endsWith('-10s.json');
  const expectedPhases = isSingleShot ? ['phase1'] : REQUIRED_PHASES;

  const missingPhases = expectedPhases.filter((p) => !theme.phases[p]);
  if (missingPhases.length) {
    throw new Error(`Theme "${sourcePath}" is missing phases: ${missingPhases.join(', ')}`);
  }
  for (const phaseKey of expectedPhases) {
    const phase = theme.phases[phaseKey];
    if (!phase.prompt) throw new Error(`Theme "${sourcePath}" phases.${phaseKey} is missing a "prompt"`);
    if (!phase.duration) throw new Error(`Theme "${sourcePath}" phases.${phaseKey} is missing a "duration"`);
  }

  const missingAudio = REQUIRED_AUDIO_LAYERS.filter((a) => !theme.audio[a]);
  if (missingAudio.length) {
    throw new Error(`Theme "${sourcePath}" is missing audio layer(s): ${missingAudio.join(', ')}`);
  }
  for (const layerKey of REQUIRED_AUDIO_LAYERS) {
    if (!theme.audio[layerKey].prompt) {
      throw new Error(`Theme "${sourcePath}" audio.${layerKey} is missing a "prompt"`);
    }
  }

  if (!theme.overlay.primaryText && !theme.overlay.secondaryText) {
    throw new Error(`Theme "${sourcePath}" overlay must define at least primaryText or secondaryText`);
  }

  if (!theme.platforms.youtube) {
    throw new Error(`Theme "${sourcePath}" platforms is missing a "youtube" entry`);
  }

  return theme;
}

/**
 * Load and validate a theme by id or path. Throws with a helpful message
 * (including the list of available themes) if not found or invalid.
 *
 * `overrides` generalizes the long-standing BASE_IMAGE_URL_OVERRIDE env-var
 * pattern into a per-run mechanism so a user can supply their own images,
 * a target/reference image, or per-phase source video — without editing
 * theme JSON — via CLI flags (src/index.js) or the admin API
 * (admin/server.js POST /api/pipeline/start body). Supported keys:
 *   - baseImageUrl        (top-level, all phases default to this)
 *   - targetImageUrl       (top-level, anchors Tier C's Aleph transform)
 *   - phase1ImageUrl / phase2ImageUrl / phase3ImageUrl
 *       (per-phase imageUrl override)
 *   - phase2VideoInputUrl  (Tier C: source video fed to Aleph, instead of
 *                           Phase 1's actual rendered output)
 *   - phase2ReferenceImageUrl (Tier C: reference image for Aleph, instead
 *                           of targetImageUrl)
 * Any key not provided is left untouched (theme JSON / env var still wins
 * over "no override").
 */
function loadTheme(themeIdOrPath, overrides = {}) {
  if (!themeIdOrPath) {
    throw new Error(`No theme specified. Pass --theme <name>. Available themes: ${describeAvailable()}`);
  }

  let themePath = resolveThemePath(themeIdOrPath);
  if (!themePath || !fs.existsSync(themePath)) {
    if (typeof themeIdOrPath === 'string' && themeIdOrPath.endsWith('-10s')) {
      const baseThemeId = themeIdOrPath.replace(/-10s$/, '');
      const fallbackPath = resolveThemePath(baseThemeId);
      if (fallbackPath && fs.existsSync(fallbackPath)) {
        themePath = fallbackPath;
      }
    }
  }

  if (!themePath || !fs.existsSync(themePath)) {
    throw new Error(`Theme not found: "${themeIdOrPath}". Available themes: ${describeAvailable()}`);
  }

  let theme;
  try {
    theme = fs.readJsonSync(themePath);
  } catch (error) {
    throw new Error(`Failed to parse theme JSON at ${themePath}: ${error.message}`);
  }

  validateTheme(theme, themePath);

  // Optional per-deployment override so the same theme file can be reused
  // across environments without editing committed JSON (e.g. a staging
  // bucket URL vs. production). Generalized env var also still works.
  const baseImageUrl = overrides.baseImageUrl || process.env.BASE_IMAGE_URL_OVERRIDE;
  if (baseImageUrl) {
    theme = { ...theme, baseImageUrl };
  }
  if (overrides.targetImageUrl) {
    theme = { ...theme, targetImageUrl: overrides.targetImageUrl };
  }

  const phaseOverrideMap = {
    phase1: overrides.phase1BaseImageUrl || overrides.phase1ImageUrl,
    phase2: overrides.phase2BaseImageUrl || overrides.phase2ImageUrl,
    phase3: overrides.phase3BaseImageUrl || overrides.phase3ImageUrl,
  };
  const phaseTargetOverrideMap = {
    phase1: overrides.phase1TargetImageUrl,
    phase2: overrides.phase2TargetImageUrl,
    phase3: overrides.phase3TargetImageUrl,
  };
  const hasPhaseOverrides = Object.values(phaseOverrideMap).some(Boolean) ||
    Object.values(phaseTargetOverrideMap).some(Boolean) ||
    overrides.phase2VideoInputUrl || overrides.phase2ReferenceImageUrl || overrides.moduleType;

  if (hasPhaseOverrides) {
    theme = { ...theme, phases: { ...theme.phases } };
    for (const [phaseKey, imageUrl] of Object.entries(phaseOverrideMap)) {
      if (imageUrl && theme.phases[phaseKey]) {
        theme.phases[phaseKey] = { ...theme.phases[phaseKey], imageUrl };
      }
    }
    for (const [phaseKey, targetImageUrl] of Object.entries(phaseTargetOverrideMap)) {
      if (targetImageUrl && theme.phases[phaseKey]) {
        theme.phases[phaseKey] = { ...theme.phases[phaseKey], targetImageUrl };
      }
    }
    if (theme.phases.phase2) {
      if (overrides.phase2VideoInputUrl) {
        theme.phases.phase2 = { ...theme.phases.phase2, videoInputUrl: overrides.phase2VideoInputUrl };
      }
      if (overrides.phase2ReferenceImageUrl) {
        theme.phases.phase2 = { ...theme.phases.phase2, referenceImageUrl: overrides.phase2ReferenceImageUrl };
      }
    }
    
    // Apply Module Selection
    if (overrides.moduleType === 'module1' && theme.phases.phase1) {
      theme.phases.phase1.duration = 10;
      delete theme.phases.phase2;
      delete theme.phases.phase3;
    }
  }

  logger.info('Theme loaded', { id: theme.id, file: path.basename(themePath), overridesApplied: Object.keys(overrides).filter((k) => overrides[k]) });
  return theme;
}

module.exports = { loadTheme, listThemes, resolveThemePath, validateTheme, THEMES_DIR };
