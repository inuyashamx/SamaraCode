import { ToolRegistry } from "../tools/registry.js";
import { Tool, toolToDefinition, ToolResult } from "../tools/types.js";
import { ModelRouter } from "../models/router.js";
import { Message } from "../models/types.js";

export interface SubAgentConfig {
  name: string;
  role: string; // System prompt describing what this agent does
  tools: string[]; // Names of tools this agent has access to
  provider?: string; // Force a specific provider
  model?: string; // Force a specific model
  maxIterations?: number;
}

export interface SubAgentLog {
  timestamp: Date;
  type: "thinking" | "tool" | "result" | "error";
  text: string;
}

export interface SubAgentResult {
  success: boolean;
  output: string;
  data?: any;
  toolsUsed: string[];
  iterations: number;
  error?: string;
  logs: SubAgentLog[];
  tokenUsage?: { input_tokens: number; output_tokens: number; calls: number };
}

export class SubAgent {
  private config: SubAgentConfig;
  private registry: ToolRegistry;
  private localRegistry: ToolRegistry; // Subset of tools for this agent
  private router: ModelRouter;
  private messages: Message[] = [];

  constructor(config: SubAgentConfig, parentRegistry: ToolRegistry, router: ModelRouter) {
    this.config = config;
    this.registry = parentRegistry;
    this.router = router;

    // Create a local registry with only the tools this agent needs
    // Use a dummy path — we copy tools from parent, not from disk
    this.localRegistry = new ToolRegistry("_agent_local");
    for (const toolName of config.tools) {
      const tool = parentRegistry.get(toolName);
      if (tool) {
        this.localRegistry.register(tool);
      }
    }
    // If no tools matched, warn — the agent will be useless
    if (this.localRegistry.getAll().length === 0 && config.tools.length > 0) {
      console.warn(`  ⚠ Agent "${config.name}" has 0 matching tools. Requested: ${config.tools.join(", ")}`);
    }
  }

  // Add a dynamic tool specifically for this agent
  addTool(tool: Tool): void {
    this.localRegistry.register(tool);
  }

  private buildSystemPrompt(): string {
    return `You are "${this.config.name}".

${this.config.role}

Tools: ${this.localRegistry.listForLLM()}

Working directory: ${process.cwd()}

## Rules
1. Focus ONLY on your assigned task.
2. If your task has exact file paths, use them directly.
3. If file_read returns ENOENT, use dir_list to find the correct path.
4. To edit existing files use file_edit with start_line/end_line, NOT file_write.
5. After every edit, file_read the area to verify nothing broke.
6. When done, summarize what you did.
7. If stuck, explain what's missing — don't loop.`;
  }

  async execute(task: string, onProgress?: (msg: string) => void): Promise<SubAgentResult> {
    const toolsUsed: string[] = [];
    const logs: SubAgentLog[] = [];
    let iterations = 0;
    const maxIter = this.config.maxIterations || 25;
    let totalInput = 0, totalOutput = 0, llmCalls = 0;

    const log = (type: SubAgentLog["type"], text: string) => {
      logs.push({ timestamp: new Date(), type, text });
      if (onProgress) onProgress(text);
    };

    log("thinking", `Starting task: ${task.slice(0, 100)}`);
    log("thinking", `Model: ${this.config.provider || "auto"}/${this.config.model || "default"}`);

    this.messages = [
      { role: "system", content: this.buildSystemPrompt() },
      { role: "user", content: task },
    ];

    const tools = this.localRegistry.getAll().map(toolToDefinition);

    while (iterations < maxIter) {
      iterations++;

      let response;
      try {
        response = await this.router.route(this.messages, tools, {
          provider: this.config.provider,
          model: this.config.model,
        });
      } catch (err: any) {
        log("error", `LLM error: ${err.message}`);
        return {
          success: false, output: `LLM error: ${err.message}`,
          toolsUsed: [...new Set(toolsUsed)], iterations, logs,
          tokenUsage: { input_tokens: totalInput, output_tokens: totalOutput, calls: llmCalls },
          error: err.message,
        };
      }

      // Track token usage
      if (response.usage) {
        totalInput += response.usage.input_tokens;
        totalOutput += response.usage.output_tokens;
        llmCalls++;
      }

      // No tool calls — agent is done
      if (!response.tool_calls || response.tool_calls.length === 0) {
        log("result", `Done: ${response.content.slice(0, 200)}`);
        return {
          success: true,
          output: response.content,
          toolsUsed: [...new Set(toolsUsed)],
          iterations,
          logs,
          tokenUsage: { input_tokens: totalInput, output_tokens: totalOutput, calls: llmCalls },
        };
      }

      if (response.content) {
        log("thinking", response.content.slice(0, 200));
      }

      // Process tool calls
      const assistantMsg: Message = {
        role: "assistant",
        content: response.content,
        tool_calls: response.tool_calls,
      };
      this.messages.push(assistantMsg);

      for (const tc of response.tool_calls) {
        toolsUsed.push(tc.name);
        log("tool", `${tc.name}: ${JSON.stringify(tc.arguments).slice(0, 120)}`);

        let result: ToolResult;
        try {
          result = await this.localRegistry.execute(tc.name, tc.arguments);
        } catch (err: any) {
          result = { success: false, error: err.message };
        }

        if (!result.success) {
          log("error", `${tc.name} failed: ${result.error}`);
        } else {
          log("result", `${tc.name}: ok`);
        }

        this.messages.push({
          role: "tool",
          content: JSON.stringify(result),
          tool_call_id: tc.id,
        });
      }
    }

    log("error", "Max iterations reached");
    return {
      success: false,
      output: "Max iterations reached",
      toolsUsed: [...new Set(toolsUsed)],
      iterations,
      logs,
      tokenUsage: { input_tokens: totalInput, output_tokens: totalOutput, calls: llmCalls },
      error: "Max iterations reached without completion",
    };
  }

  getContext(): Message[] {
    return [...this.messages];
  }
}

// Fixed agent roles are now defined in agent-roles.ts
// Use spawn_scout, spawn_developer, etc. from the orchestrator.
