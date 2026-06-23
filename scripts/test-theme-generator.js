// scripts/test-theme-generator.js
require('dotenv').config();
const { generateThemeFromPrompt } = require('../src/api/generate-theme');
const chalk = require('chalk');

async function testGenerator() {
  console.log(chalk.cyan(`\n🧪 Testing Prompt-to-Theme AI Generator\n`));
  
  if (!process.env.OPENAI_API_KEY) {
    console.log(chalk.red(`❌ Missing OPENAI_API_KEY in .env file.`));
    console.log(chalk.yellow(`If using FreeLLMAPI.co, ensure OPENAI_API_KEY is your free key,`));
    console.log(chalk.yellow(`and OPENAI_BASE_URL is set to their endpoint (e.g., https://api.freellmapi.co/v1).`));
    process.exit(1);
  }

  console.log(chalk.blue(`Base URL: ${process.env.OPENAI_BASE_URL || 'Standard OpenAI (Default)'}`));
  console.log(chalk.blue(`Model:    ${process.env.OPENAI_MODEL || 'gpt-4o (Default)'}\n`));

  const samplePrompt = "A glowing neon cyberpunk sneaker hovering over a rainy futuristic street in Neo-Tokyo. Make it dramatic.";
  console.log(chalk.white(`Input Prompt: "${samplePrompt}"`));
  console.log(chalk.gray(`Generating theme...\n`));

  try {
    const theme = await generateThemeFromPrompt(samplePrompt);
    console.log(chalk.green(`✅ Theme Generated Successfully!`));
    console.log(chalk.gray(`\n${JSON.stringify(theme, null, 2)}\n`));
  } catch (error) {
    console.log(chalk.red(`\n❌ Generation failed:`));
    console.error(error);
  }
}

testGenerator();
