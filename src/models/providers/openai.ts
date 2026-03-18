import OpenAI from "openai";
import { LLMProvider, LLMResponse, Message, ToolCall } from "../types.js";
import { ToolDefinition } from "../../tools/types.js";

export class OpenAIProvider implements LLMProvider {
  name = "openai";
  models = [];
  private client: OpenAI | null = null;

  async isAvailable(): Promise<boolean> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return false;
    this.client = new OpenAI({ apiKey });
    return true;
  }

  async chat(messages: Message[], tools?: ToolDefinition[], model?: string): Promise<LLMResponse> {
    if (!this.client) throw new Error("OpenAI not initialized");

    const modelName = model || "gpt-4o-mini";

    const openaiMessages: any[] = messages.map((m) => {
      if (m.role === "tool") {
        return { role: "tool", content: m.content, tool_call_id: m.tool_call_id };
      }
      if (m.tool_calls && m.tool_calls.length > 0) {
        return {
          role: "assistant",
          content: m.content || null,
          tool_calls: m.tool_calls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })),
        };
      }
      return { role: m.role, content: m.content };
    });

    const params: any = {
      model: modelName,
      messages: openaiMessages,
      max_tokens: 8192,
    };

    if (tools && tools.length > 0) {
      params.tools = tools.map((t) => ({
        type: "function",
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }

    const response = await this.client.chat.completions.create(params);
    const choice = response.choices[0];

    const toolCalls: ToolCall[] = [];
    if (choice.message.tool_calls) {
      for (const tc of choice.message.tool_calls) {
        const fn = (tc as any).function;
        if (fn) {
          toolCalls.push({
            id: tc.id,
            name: fn.name,
            arguments: JSON.parse(fn.arguments || "{}"),
          });
        }
      }
    }

    return {
      content: choice.message.content || "",
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      model: modelName,
      usage: response.usage
        ? { input_tokens: response.usage.prompt_tokens, output_tokens: response.usage.completion_tokens }
        : undefined,
    };
  }
}
