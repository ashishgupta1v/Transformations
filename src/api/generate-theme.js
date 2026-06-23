// src/api/generate-theme.js
const { OpenAI } = require('openai');
const logger = require('../utils/logger');
const fs = require('fs-extra');
const path = require('path');

// Lazily constructed: the OpenAI SDK throws synchronously at construction
// time if no apiKey is present, which previously happened at MODULE LOAD
// time (this object was built at the top of the file). That meant
// requiring this file — which admin/server.js does unconditionally for
// its optional POST /api/themes/generate route — would crash the entire
// admin server's startup in any environment missing OPENAI_API_KEY, even
// though every other route works fine without it. Building the client
// inside the function instead means a missing key only breaks the one
// route that actually needs it, with a clear error in that request's
// response rather than an admin-server-wide boot crash.
let openai = null;
function getClient() {
  if (!openai) {
    openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      baseURL: process.env.OPENAI_BASE_URL || undefined,
    });
  }
  return openai;
}

async function generateThemeFromPrompt(userPrompt) {
  logger.info(`Generating theme from prompt: ${userPrompt}`);
  
  const systemMessage = `
    You are an expert AI video prompt engineer and creative director.
    Your job is to take a simple user description and translate it into a highly detailed JSON theme file for a 3-phase video generation pipeline.
    
    The pipeline works as follows (current provider stack, muapi.ai-based):
    - Phase 1: Baseline context (muapi.ai Kling v2.1 Standard, image-to-video)
    - Phase 2: Dramatic SciFi Transformation (muapi.ai Kling v2.1 Standard for Tier A/B,
      or muapi.ai Runway Gen-4 Aleph video-to-video for Tier C continuity — same prompt
      field either way, the pipeline picks the provider based on config)
    - Phase 3: Resolution / Hero Shot (muapi.ai Kling v2.1 Standard, image-to-video)
    - Audio: ElevenLabs sound-generation for ambient + transformation SFX, and a
      muapi.ai Suno (suno-create-music) instrumental Music Score
    
    Output a valid JSON object matching this schema:
    {
      "id": "slug-format-name",
      "displayName": "Readable Name",
      "subjectType": "product",
      "tagline": "Short tagline",
      "phases": {
        "phase1": { "name": "Baseline", "prompt": "Highly detailed Runway prompt", "duration": 5 },
        "phase2": { "name": "Transformation", "prompt": "Highly detailed Kling sci-fi prompt", "duration": 5 },
        "phase3": { "name": "Resolution", "prompt": "Highly detailed Pika hero shot prompt", "duration": 5 }
      },
      "audio": {
        "ambientPrompt": "ElevenLabs prompt for phase 1",
        "transformationPrompt": "ElevenLabs prompt for phase 2",
        "musicScorePrompt": "Suno AI instrumental prompt"
      },
      "platforms": {
        "instagramReel": { "caption": "Viral IG caption with hashtags" },
        "youtube": { "title": "YouTube Title", "description": "YouTube Description" }
      }
    }
  `;

  try {
    const client = getClient();
    const model = process.env.OPENAI_MODEL || "gpt-4o";
    const response = await client.chat.completions.create({
      model: model,
      messages: [
        { role: "system", content: systemMessage },
        { role: "user", content: userPrompt }
      ],
      response_format: { type: "json_object" }
    });

    const themeJson = JSON.parse(response.choices[0].message.content);
    
    // Save the generated theme to the themes directory
    const themePath = path.join(__dirname, '../../themes', `${themeJson.id}.json`);
    await fs.writeJson(themePath, themeJson, { spaces: 2 });
    
    logger.info(`Successfully generated and saved theme: ${themeJson.id}`);
    return themeJson;
  } catch (error) {
    logger.error('Failed to generate theme from prompt', { error: error.message });
    throw error;
  }
}

module.exports = { generateThemeFromPrompt };
