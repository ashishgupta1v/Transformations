# Themes

A **theme** is a single JSON file that holds everything *subject-specific*
about one pipeline run: the three video-phase prompts, the audio prompts,
on-screen overlay text, branding strings, and per-platform titles/captions.
Everything *engine-specific* (FFmpeg settings, resolutions, retry/polling
tuning, cost estimates, storage credentials) stays in
`config/pipeline.config.js` and is shared by every theme.

This split is what lets the same codebase generate a sacred-temple video,
a product launch film, a city tourism reel, or anything else — by swapping
which theme file gets loaded, with zero code changes.

## Using a theme

```bash
node src/index.js list-themes
node src/index.js generate --theme jagannatha-rathyatra
node src/index.js generate --theme example-product-launch
```

If `--theme` is omitted, the CLI falls back to the `DEFAULT_THEME` env var
(see `.env.example`), and errors with the list of available themes if
neither is set.

## Creating a new theme

1. Copy `themes/_template.json` to `themes/<your-id>.json`.
2. Fill in every field — see the field reference below.
3. Run `node src/index.js list-themes` to confirm it's picked up.
4. Run `node src/index.js generate --theme <your-id> --skip-publish` to do a
   dry run before connecting real publishing credentials.

Theme files are committed source, not runtime state — they belong in git
alongside the code (unlike `data/cost-log.json` or `output/`, which are
gitignored).

## Field reference

| Field | Type | Used by |
|---|---|---|
| `id` | string | Should match the filename (informational; the filename is what's actually used to resolve `--theme`) |
| `displayName` | string | Banners, notifications, admin UI, YouTube/description templating |
| `subjectType` | string | Free-form (`deity`, `location`, `product`, `business`, `other`) — informational only |
| `language` | string | Not currently auto-applied; documents intent for translators |
| `tagline` | string | Appended to WhatsApp notification templates |
| `author` | string | Shown in generated descriptions/banners |
| `bannerTitle` | string | CLI startup banner text |
| `baseImageUrl` | string | Starting image fed to the phase-1 video provider (Runway). Can be overridden per-deployment with the `BASE_IMAGE_URL_OVERRIDE` env var without editing the theme file |
| `phases.phase1/phase2/phase3` | object | `src/video/generator.js` — each needs `name`, `duration` (seconds), `provider`, `prompt`, `negativePrompt` |
| `audio.ambient/transformation/music` | object | `src/audio/generator.js` — each needs `prompt`, `duration`, `volume`; `ambient`/`transformation` also take `promptInfluence` (ElevenLabs sound-generation strength, 0–1); `music` also takes `instrumental` (boolean, passed to Suno) |
| `overlay` | object | `src/assembly/assembler.js` — `primaryText`/`secondaryText` drawn as on-screen text, `startTime`/`endTime`/`fadeIn`/`fadeOut` in seconds |
| `platforms.youtube` | object | `title`, `description`, `tags`, `categoryId`, `privacy`, `defaultLanguage` |
| `platforms.shorts` | object | `title`, `description`, `tags`, `categoryId`, `privacy` |
| `platforms.instagramReel` | object | `caption` |
| `platforms.twitter` | object | `text` |
| `platforms.facebook` | object | `description` |
| `platforms.whatsapp` | object | `liveText` — short status line, combined with the file path at runtime |
| `notifications.whatsappComplete/whatsappError/whatsappLive` | string | Templates with `{displayName}`, `{tagline}`, `{duration}`, `{exportCount}`, `{stage}`, `{error}`, `{path}` placeholders, substituted by `src/notify/whatsapp.js` |

Technical/engine fields that stay OUT of theme files (they live in
`config/pipeline.config.js` instead): FFmpeg encode params, platform
resolution/bitrate/format/filename/cropFilter, retry/polling tuning, cost
estimates, budget tiers, Oracle storage connection config.

## Included examples

- `jagannatha-rathyatra.json` — the original Shree Jagannatha Temple Puri
  Rath Yatra sacred-to-sci-fi theme, fully migrated from the pipeline's
  original hardcoded content. Kept as a complete, working reference example.
- `example-product-launch.json` — a sneaker/product-launch theme, included
  to prove the pipeline genuinely works for non-religious subjects too.
- `_template.json` — blank starting point for authoring a new theme
  (ignored by `list-themes` since its filename starts with `_`).
