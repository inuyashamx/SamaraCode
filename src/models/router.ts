import { LLMProvider, LLMResponse, Message, TaskComplexity } from "./types.js";
import { ToolDefinition } from "../tools/types.js";
import { SamaraCodeConfig } from "../config/index.js";
import { ClaudeProvider } from "./providers/claude.js";
import { OpenAIProvider } from "./providers/openai.js";
import { DeepSeekProvider } from "./providers/deepseek.js";
import { GeminiProvider } from "./providers/gemini.js";

interface ProviderEntry {
  provider: LLMProvider;
  available: boolean;
}

export class ModelRouter {
  private providers: Map<string, ProviderEntry> = new Map();
  private config: SamaraCodeConfig | null = null;
  private defaultProvider: string = "";

  // Initialize from config (setup wizard)
  async initializeFromConfig(config: SamaraCodeConfig): Promise<void> {
    this.config = config;
    console.log("🔍 Initializing model providers...");

    // Gemini
    if (config.providers.gemini) {
      const gemini = new GeminiProvider();
      gemini.initialize(config.providers.gemini.apiKey);
      this.providers.set("gemini", { provider: gemini, available: true });
      console.log(`  ✓ gemini (${config.providers.gemini.defaultModel || "default"})`);
    }

    // Claude
    if (config.providers.claude) {
      process.env.ANTHROPIC_API_KEY = config.providers.claude.apiKey;
      const claude = new ClaudeProvider();
      const ok = await claude.isAvailable();
      this.providers.set("claude", { provider: claude, available: ok });
      console.log(`  ${ok ? "✓" : "✗"} claude`);
    }

    // OpenAI
    if (config.providers.openai) {
      process.env.OPENAI_API_KEY = config.providers.openai.apiKey;
      const openai = new OpenAIProvider();
      const ok = await openai.isAvailable();
      this.providers.set("openai", { provider: openai, available: ok });
      console.log(`  ${ok ? "✓" : "✗"} openai`);
    }

    // DeepSeek
    if (config.providers.deepseek) {
      process.env.DEEPSEEK_API_KEY = config.providers.deepseek.apiKey;
      const ds = new DeepSeekProvider();
      ds.initialize(config.providers.deepseek.apiKey);
      this.providers.set("deepseek", { provider: ds, available: true });
      console.log(`  ✓ deepseek`);
    }

    // Set default — prefer Gemini as primary
    for (const [name, entry] of this.providers) {
      if (entry.available) {
        this.defaultProvider = name;
        break;
      }
    }

    if (!this.defaultProvider) {
      throw new Error("No LLM providers available.");
    }
  }

  // Legacy: initialize from env vars
  async initialize(): Promise<void> {
    console.log("🔍 Detecting available models...");

    const allProviders: LLMProvider[] = [
      new ClaudeProvider(),
      new OpenAIProvider(),
    ];

    for (const provider of allProviders) {
      const available = await provider.isAvailable();
      this.providers.set(provider.name, { provider, available });
      if (available) {
        console.log(`  ✓ ${provider.name}: ${provider.models.join(", ")}`);
        if (!this.defaultProvider) this.defaultProvider = provider.name;
      } else {
        console.log(`  ✗ ${provider.name}: not available`);
      }
    }

    if (!this.defaultProvider) {
      throw new Error("No LLM providers available. Set ANTHROPIC_API_KEY or OPENAI_API_KEY.");
    }
  }

  getAvailableProviders(): { name: string; models: string[] }[] {
    return Array.from(this.providers.entries())
      .filter(([_, s]) => s.available)
      .map(([name, s]) => ({ name, models: s.provider.models }));
  }

  estimateComplexity(task: string): TaskComplexity {
    const lower = task.toLowerCase();

    const expertKeywords = ["architect", "design system", "refactor entire", "security audit", "optimize performance", "complex algorithm", "migrate"];
    if (expertKeywords.some((k) => lower.includes(k))) return "expert";

    const complexKeywords = ["implement", "create feature", "debug", "fix bug", "integrate", "api", "database", "build", "develop"];
    if (complexKeywords.some((k) => lower.includes(k))) return "complex";

    const simpleKeywords = ["list", "show", "what is", "explain", "read", "find", "search", "check"];
    if (simpleKeywords.some((k) => lower.includes(k))) return "simple";

    return "moderate";
  }

  async route(
    messages: Message[],
    tools?: ToolDefinition[],
    options?: { provider?: string; model?: string; complexity?: TaskComplexity }
  ): Promise<LLMResponse> {
    // Explicit provider/model
    if (options?.provider && options.provider !== "auto") {
      const entry = this.providers.get(options.provider);
      if (!entry?.available) throw new Error(`Provider "${options.provider}" not available`);
      const model = options.model !== "auto" ? options.model : undefined;
      return entry.provider.chat(messages, tools, model);
    }

    // Auto-route from config
    if (this.config) {
      const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
      const complexity = options?.complexity || this.estimateComplexity(lastUserMsg?.content || "");
      const rule = this.config.routing[complexity];

      if (rule && rule.provider !== "auto") {
        const entry = this.providers.get(rule.provider);
        if (entry?.available) {
          const model = rule.model !== "auto" ? rule.model : undefined;
          return entry.provider.chat(messages, tools, model);
        }
      }
    }

    // Fallback
    const entry = this.providers.get(this.defaultProvider)!;
    return entry.provider.chat(messages, tools);
  }

  getRoutingInfo(task: string): { complexity: TaskComplexity; provider: string; model: string; reason: string } {
    const complexity = this.estimateComplexity(task);

    if (this.config) {
      const rule = this.config.routing[complexity];
      if (rule && rule.provider !== "auto") {
        const entry = this.providers.get(rule.provider);
        if (entry?.available) {
          return {
            complexity,
            provider: rule.provider,
            model: rule.model,
            reason: `${complexity} → ${rule.provider}/${rule.model}`,
          };
        }
      }
    }

    return {
      complexity,
      provider: this.defaultProvider,
      model: "default",
      reason: `fallback → ${this.defaultProvider}`,
    };
  }
}
