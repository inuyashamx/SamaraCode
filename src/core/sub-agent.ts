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
    this.localRegistry = new ToolRegistry("data/tools");
    for (const toolName of config.tools) {
      const tool = parentRegistry.get(toolName);
      if (tool) {
        this.localRegistry.register(tool);
      }
    }
  }

  // Add a dynamic tool specifically for this agent
  addTool(tool: Tool): void {
    this.localRegistry.register(tool);
  }

  private buildSystemPrompt(): string {
    return `You are a specialized sub-agent: "${this.config.name}".

## Your role
${this.config.role}

## Your tools
${this.localRegistry.listForLLM()}

## Environment
- OS: ${process.platform} (${process.arch})
- Shell: ${process.platform === "win32" ? "PowerShell" : "bash"}
- Working directory: ${process.cwd()}
- Node: ${process.version}

## Rules
- Focus ONLY on your assigned task. Do not deviate.
- Use your tools to accomplish the task.
- When done, provide a clear summary of what you did and the result.
- Be concise. No unnecessary explanation.
- If something fails, try a different approach. Don't repeat the same failing command.
- If you can't complete the task, explain what's missing.

## Shell commands — IMPORTANT
- ALWAYS prefer cross-platform commands: node, npm, npx, git, tsc, etc.
- For file operations, use the file_read/file_write/dir_list tools instead of shell commands when possible.
- NEVER use sleep, wait, ping-as-delay, or any polling mechanism. You are independent — never wait for other agents.
- NEVER use OS-specific commands (ls, cat, grep on Windows / dir, type on Mac/Linux). Use the builtin tools instead.
- If you need to run something, prefer: npx, node -e "...", or npm scripts.`;
  }

  async execute(task: string, onProgress?: (msg: string) => void): Promise<SubAgentResult> {
    const toolsUsed: string[] = [];
    const logs: SubAgentLog[] = [];
    let iterations = 0;
    const maxIter = this.config.maxIterations || 25;

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
          error: err.message,
        };
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
      error: "Max iterations reached without completion",
    };
  }

  getContext(): Message[] {
    return [...this.messages];
  }
}

// Factory: create common sub-agent configurations
export const AgentTemplates = {
  researcher: (topic: string): SubAgentConfig => ({
    name: `researcher-${Date.now()}`,
    role: `You are a research agent. Search the web and gather information about: ${topic}. Summarize findings clearly with sources.`,
    tools: ["web_search", "web_fetch", "memory_save"],
  }),

  coder: (task: string): SubAgentConfig => ({
    name: `coder-${Date.now()}`,
    role: `You are a coding agent. Write, read, and modify code to accomplish tasks. Test your work.`,
    tools: ["file_read", "file_write", "dir_list", "bash_execute", "grep_search"],
  }),

  installer: (what: string): SubAgentConfig => ({
    name: `installer-${Date.now()}`,
    role: `You are an installer agent. Install and configure: ${what}. Verify the installation works.`,
    tools: ["bash_execute", "file_write", "file_read", "web_search", "web_fetch"],
  }),

  analyst: (task: string): SubAgentConfig => ({
    name: `analyst-${Date.now()}`,
    role: `You are an analysis agent. Read code and files, search for patterns, and provide detailed analysis.`,
    tools: ["file_read", "dir_list", "grep_search", "bash_execute"],
  }),
};
