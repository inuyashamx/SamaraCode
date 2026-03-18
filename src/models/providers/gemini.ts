import { LLMProvider, LLMResponse, Message, ToolCall } from "../types.js";
import { ToolDefinition } from "../../tools/types.js";

export class GeminiProvider implements LLMProvider {
  name = "gemini";
  models = ["gemini-2.5-pro", "gemini-3.1-flash-lite-preview", "gemini-2.5-flash"];
  private apiKey: string = "";

  async isAvailable(): Promise<boolean> {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return false;
    this.apiKey = key;
    return true;
  }

  initialize(apiKey: string): void {
    this.apiKey = apiKey;
  }

  async chat(messages: Message[], tools?: ToolDefinition[], model?: string): Promise<LLMResponse> {
    if (!this.apiKey) throw new Error("Gemini not initialized");

    const modelName = model || "gemini-3.1-flash-lite-preview";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${this.apiKey}`;

    // Convert messages to Gemini format
    const systemMsg = messages.find((m) => m.role === "system");
    const contents: any[] = [];

    for (const msg of messages) {
      if (msg.role === "system") continue;
      if (msg.role === "tool") {
        contents.push({
          role: "function",
          parts: [
            {
              functionResponse: {
                name: msg.tool_call_id || "unknown",
                response: { content: msg.content },
              },
            },
          ],
        });
        continue;
      }

      const role = msg.role === "assistant" ? "model" : "user";

      if (msg.tool_calls && msg.tool_calls.length > 0) {
        // Rebuild model parts with thought signatures for Gemini 3.x
        const parts: any[] = [];
        if (msg.content) {
          parts.push({ text: msg.content });
        }
        for (const tc of msg.tool_calls) {
          const part: any = {
            functionCall: { name: tc.name, args: tc.arguments },
          };
          if (tc.thoughtSignature) {
            part.thoughtSignature = tc.thoughtSignature;
          }
          parts.push(part);
        }
        contents.push({ role: "model", parts });
      } else {
        contents.push({ role, parts: [{ text: msg.content }] });
      }
    }

    const body: any = { contents };

    if (systemMsg) {
      body.systemInstruction = { parts: [{ text: systemMsg.content }] };
    }

    if (tools && tools.length > 0) {
      body.tools = [
        {
          functionDeclarations: tools.map((t) => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
          })),
        },
      ];
    }

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = (await response.json()) as any;

    if (!response.ok) {
      throw new Error(`Gemini error: ${data.error?.message || JSON.stringify(data)}`);
    }

    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts || [];

    let content = "";
    const toolCalls: ToolCall[] = [];

    for (const part of parts) {
      if (part.text) {
        content += part.text;
      }
      if (part.functionCall) {
        toolCalls.push({
          id: `gemini_${Date.now()}_${Math.random().toString(36).slice(2)}`,
          name: part.functionCall.name,
          arguments: part.functionCall.args || {},
          thoughtSignature: part.thoughtSignature || undefined,
        });
      }
    }

    return {
      content,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      model: modelName,
      usage: data.usageMetadata
        ? {
            input_tokens: data.usageMetadata.promptTokenCount || 0,
            output_tokens: data.usageMetadata.candidatesTokenCount || 0,
          }
        : undefined,
    };
  }
}
