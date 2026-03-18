import { LLMProvider, LLMResponse, Message, ToolCall } from "../types.js";
import { ToolDefinition } from "../../tools/types.js";

export class OllamaProvider implements LLMProvider {
  name = "ollama";
  models: string[] = [];
  private baseUrl: string;

  constructor(baseUrl: string = "http://127.0.0.1:11434") {
    this.baseUrl = baseUrl;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        const data = await res.json() as any;
        this.models = (data.models || []).map((m: any) => m.name);
        return this.models.length > 0;
      }
      return false;
    } catch {
      return false;
    }
  }

  // Pick the best coding model available
  getBestModel(): string {
    // Prefer coding-specific models over general ones
    const preferred = [
      "qwen2.5-coder:7b", "qwen2.5-coder:32b",
      "deepcoder:14b", "codestral:22b", "deepseek-coder:33b",
      "qwen3:8b", "llama3.1:8b",
    ];
    for (const p of preferred) {
      if (this.models.includes(p)) return p;
    }
    return this.models[0] || "qwen3:8b";
  }

  async chat(messages: Message[], tools?: ToolDefinition[], model?: string): Promise<LLMResponse> {
    const modelName = model || this.getBestModel();

    const ollamaMessages = messages.map((m) => ({
      role: m.role === "tool" ? "assistant" : m.role,
      content: m.content,
    }));

    // Ollama supports function calling for some models
    const body: any = {
      model: modelName,
      messages: ollamaMessages,
      stream: false,
    };

    if (tools && tools.length > 0) {
      body.tools = tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }

    const res = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json() as any;

    const toolCalls: ToolCall[] = [];
    if (data.message?.tool_calls) {
      for (const tc of data.message.tool_calls) {
        toolCalls.push({
          id: `ollama_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          name: tc.function.name,
          arguments: tc.function.arguments || {},
        });
      }
    }

    return {
      content: data.message?.content || "",
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      model: modelName,
      usage: data.eval_count
        ? { input_tokens: data.prompt_eval_count || 0, output_tokens: data.eval_count || 0 }
        : undefined,
    };
  }
}
