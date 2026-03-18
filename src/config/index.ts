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
    claude?: { apiKey: string; defaultModel: string };
    openai?: { apiKey: string; defaultModel: string };
    deepseek?: { apiKey: string; defaultModel: string };
    gemini?: { apiKey: string; defaultModel: string };
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
    const config = { ...defaultConfig(), ...JSON.parse(raw) };
    // Auto-migrate old model names
    migrateModels(config);
    return config;
  } catch {
    return defaultConfig();
  }
}

function migrateModels(config: SamaraCodeConfig): void {
  const replacements: Record<string, string> = {
    "claude-sonnet-4-20250514": "claude-sonnet-4-6",
    "claude-opus-4-20250514": "claude-opus-4-6",
    "claude-haiku-4-5-20251001": "claude-haiku-4-5",
    "claude-sonnet-4-6-20250627": "claude-sonnet-4-6",
    "claude-opus-4-6-20250627": "claude-opus-4-6",
    "claude-haiku-4-5-20250627": "claude-haiku-4-5",
    "gemini-3.1-flash": "gemini-3.1-flash-lite-preview",
    "gemini-3.1-flash-lite": "gemini-3.1-flash-lite-preview",
    "gemini-3.1-pro": "gemini-2.5-pro",
    "gemini-3.1-pro-preview": "gemini-2.5-pro",
  };

  // Migrate provider defaults
  if (config.providers.claude) {
    const m = config.providers.claude.defaultModel;
    if (replacements[m]) config.providers.claude.defaultModel = replacements[m];
  }
  if (config.providers.gemini) {
    const m = config.providers.gemini.defaultModel;
    if (replacements[m]) config.providers.gemini.defaultModel = replacements[m];
  }

  // Migrate routing
  for (const level of ["simple", "moderate", "complex", "expert"] as const) {
    const r = config.routing[level];
    if (r && replacements[r.model]) {
      r.model = replacements[r.model];
    }
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

  console.log(`You need a Gemini API key to get started.`);
  console.log(`Other providers (Claude, GPT) can be configured later in the UI.\n`);

  // Gemini (required)
  console.log(`── Google Gemini ──`);
  console.log(`  Model: gemini-3.1-flash-lite-preview (fast, cheap, great for coding)`);
  console.log(`  Get your key at: https://aistudio.google.com/apikey\n`);
  const geminiKey = await ask(rl, `  Gemini API Key: `);
  if (geminiKey.trim()) {
    config.providers.gemini = {
      apiKey: geminiKey.trim(),
      defaultModel: "gemini-3.1-flash-lite-preview",
    };
    console.log(`  ✓ Gemini configured\n`);
  } else {
    console.log(`\n⚠️  Gemini API key is required to run the agent.`);
    console.log(`  Run samara again to configure.\n`);
    return config;
  }

  // Auto-configure routing (Gemini for everything)
  configureRouting(config);

  config.setupComplete = true;
  await saveConfig(config);

  console.log(`\n✅ Setup complete!`);
  console.log(`  Provider: Gemini (gemini-3.1-flash-lite-preview)`);
  console.log(`\n  💡 You can add Claude and GPT later from the web UI settings.\n`);

  return config;
}

function configureRouting(config: SamaraCodeConfig): void {
  const hasClaude = !!config.providers.claude;
  const hasOpenai = !!config.providers.openai;
  const hasDeepseek = !!config.providers.deepseek;
  const hasGemini = !!config.providers.gemini;

  // Simple: cheapest available
  if (hasGemini) {
    config.routing.simple = { provider: "gemini", model: "gemini-3.1-flash-lite-preview" };
  } else if (hasDeepseek) {
    config.routing.simple = { provider: "deepseek", model: "deepseek-chat" };
  } else if (hasOpenai) {
    config.routing.simple = { provider: "openai", model: "gpt-5.4-mini" };
  } else if (hasClaude) {
    config.routing.simple = { provider: "claude", model: "claude-haiku-4-5" };
  }

  // Moderate
  if (hasGemini) {
    config.routing.moderate = { provider: "gemini", model: "gemini-3.1-flash-lite-preview" };
  } else if (hasDeepseek) {
    config.routing.moderate = { provider: "deepseek", model: "deepseek-chat" };
  } else if (hasOpenai) {
    config.routing.moderate = { provider: "openai", model: "gpt-5.4-mini" };
  } else if (hasClaude) {
    config.routing.moderate = { provider: "claude", model: "claude-sonnet-4-6" };
  }

  // Complex: strong model
  if (hasClaude) {
    config.routing.complex = { provider: "claude", model: "claude-sonnet-4-6" };
  } else if (hasGemini) {
    config.routing.complex = { provider: "gemini", model: "gemini-2.5-pro" };
  } else if (hasOpenai) {
    config.routing.complex = { provider: "openai", model: "gpt-5.4" };
  } else if (hasDeepseek) {
    config.routing.complex = { provider: "deepseek", model: "deepseek-reasoner" };
  }

  // Expert: best available
  if (hasClaude) {
    config.routing.expert = { provider: "claude", model: "claude-opus-4-6" };
  } else if (hasGemini) {
    config.routing.expert = { provider: "gemini", model: "gemini-2.5-pro" };
  } else if (hasOpenai) {
    config.routing.expert = { provider: "openai", model: "gpt-5.4-pro" };
  } else if (hasDeepseek) {
    config.routing.expert = { provider: "deepseek", model: "deepseek-reasoner" };
  }
}
