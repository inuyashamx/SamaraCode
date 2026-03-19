import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import * as readline from "readline";

// Global config in ~/.samaracode/ — works from any directory
const AUTONOMO_HOME = path.join(os.homedir(), ".samaracode");
const CONFIG_PATH = path.join(AUTONOMO_HOME, "config.json");

export function getSamaraCodeHome(): string {
  return AUTONOMO_HOME;
}

export async function ensureSamaraCodeHome(): Promise<void> {
  await fs.mkdir(AUTONOMO_HOME, { recursive: true });
  await fs.mkdir(path.join(AUTONOMO_HOME, "tools"), { recursive: true });
  await fs.mkdir(path.join(AUTONOMO_HOME, "memory"), { recursive: true });
  await fs.mkdir(path.join(AUTONOMO_HOME, "audit"), { recursive: true });
}

export interface SamaraCodeConfig {
  version: string;
  setupComplete: boolean;
  autonomyLevel: 0 | 1 | 2 | 3;
  providers: {
    claude?: { apiKey: string; defaultModel?: string };
    openai?: { apiKey: string; defaultModel?: string };
    deepseek?: { apiKey: string; defaultModel?: string };
    gemini?: { apiKey: string; defaultModel?: string };
  };
  routing: {
    simple: { provider: string; model: string };
    moderate: { provider: string; model: string };
    complex: { provider: string; model: string };
    expert: { provider: string; model: string };
  };
  background: {
    maxConcurrentTasks: number;
    maxConcurrentAgents: number;
  };
}

function defaultConfig(): SamaraCodeConfig {
  return {
    version: "0.1.0",
    setupComplete: false,
    autonomyLevel: 1,
    providers: {},
    routing: {
      simple: { provider: "auto", model: "auto" },
      moderate: { provider: "auto", model: "auto" },
      complex: { provider: "auto", model: "auto" },
      expert: { provider: "auto", model: "auto" },
    },
    background: {
      maxConcurrentTasks: 5,
      maxConcurrentAgents: 3,
    },
  };
}

export async function loadConfig(): Promise<SamaraCodeConfig> {
  try {
    await ensureSamaraCodeHome();
    const raw = await fs.readFile(CONFIG_PATH, "utf-8");
    return { ...defaultConfig(), ...JSON.parse(raw) };
  } catch {
    return defaultConfig();
  }
}

export async function saveConfig(config: SamaraCodeConfig): Promise<void> {
  await ensureSamaraCodeHome();
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
}

function ask(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

export async function runSetupWizard(rl: readline.Interface): Promise<SamaraCodeConfig> {
  const config = defaultConfig();

  console.log(`\n╔═══════════════════════════════════════════╗`);
  console.log(`║           🚀 SamaraCode Setup            ║`);
  console.log(`╚═══════════════════════════════════════════╝\n`);

  console.log(`You need at least one API key to get started.`);
  console.log(`Get a Gemini key at: https://aistudio.google.com/apikey\n`);

  // Gemini
  const geminiKey = await ask(rl, `  Gemini API Key (required): `);
  if (geminiKey.trim()) {
    config.providers.gemini = { apiKey: geminiKey.trim() };
    console.log(`  ✓ Gemini configured\n`);
  } else {
    console.log(`\n⚠️  Gemini API key is required.`);
    console.log(`  Run samara again to configure.\n`);
    return config;
  }

  // Optional: Claude
  const claudeKey = await ask(rl, `  Claude API Key (optional, press Enter to skip): `);
  if (claudeKey.trim()) {
    config.providers.claude = { apiKey: claudeKey.trim() };
    console.log(`  ✓ Claude configured\n`);
  }

  // Optional: OpenAI
  const openaiKey = await ask(rl, `  OpenAI API Key (optional, press Enter to skip): `);
  if (openaiKey.trim()) {
    config.providers.openai = { apiKey: openaiKey.trim() };
    console.log(`  ✓ OpenAI configured\n`);
  }

  config.setupComplete = true;
  await saveConfig(config);

  const providers = Object.keys(config.providers).join(", ");
  console.log(`\n✅ Setup complete! Providers: ${providers}\n`);

  return config;
}
