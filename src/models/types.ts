import { ToolDefinition } from "../tools/types.js";

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
  thoughtSignature?: string; // Gemini 3.x thought signatures
}

export interface LLMResponse {
  content: string;
  tool_calls?: ToolCall[];
  model: string;
  usage?: { input_tokens: number; output_tokens: number };
}

export interface LLMProvider {
  name: string;
  models: string[];
  isAvailable(): Promise<boolean>;
  chat(messages: Message[], tools?: ToolDefinition[], model?: string): Promise<LLMResponse>;
}

export interface ModelConfig {
  provider: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

// Complexity estimation for routing
export type TaskComplexity = "simple" | "moderate" | "complex" | "expert";
