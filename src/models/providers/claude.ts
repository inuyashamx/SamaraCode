import Anthropic from "@anthropic-ai/sdk";
import { LLMProvider, LLMResponse, Message, ToolCall } from "../types.js";
import { ToolDefinition } from "../../tools/types.js";

export class ClaudeProvider implements LLMProvider {
  name = "claude";
  models = [];
  private client: Anthropic | null = null;

  async isAvailable(): Promise<boolean> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return false;
    this.client = new Anthropic({ apiKey });
    return true;
  }

  async chat(messages: Message[], tools?: ToolDefinition[], model?: string): Promise<LLMResponse> {
    if (!this.client) throw new Error("Claude not initialized");

    const modelName = model || "claude-sonnet-4-6";

    // Separate system message
    const systemMsg = messages.find((m) => m.role === "system");
    const chatMessages = messages
      .filter((m) => m.role !== "system")
      .map((m) => {
        if (m.role === "tool") {
          return {
            role: "user" as const,
            content: [
              {
                type: "tool_result" as const,
                tool_use_id: m.tool_call_id || "",
                content: m.content,
              },
            ],
          };
        }
        if (m.tool_calls && m.tool_calls.length > 0) {
          return {
            role: "assistant" as const,
            content: [
              ...(m.content ? [{ type: "text" as const, text: m.content }] : []),
              ...m.tool_calls.map((tc) => ({
                type: "tool_use" as const,
                id: tc.id,
                name: tc.name,
                input: tc.arguments,
              })),
            ],
          };
        }
        return { role: m.role as "user" | "assistant", content: m.content };
      });

    const params: any = {
      model: modelName,
      max_tokens: 8192,
      messages: chatMessages,
    };

    if (systemMsg) {
      params.system = systemMsg.content;
    }

    if (tools && tools.length > 0) {
      params.tools = tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
    }

    const response = await this.client.messages.create(params);

    let content = "";
    const toolCalls: ToolCall[] = [];

    for (const block of response.content) {
      if (block.type === "text") {
        content += block.text;
      } else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input as Record<string, any>,
        });
      }
    }

    return {
      content,
      tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
      model: modelName,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
    };
  }
}
