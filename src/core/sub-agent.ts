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

## CRITICAL — finding files
- If your task includes exact file paths, use those DIRECTLY. Do NOT guess alternative paths.
- If you need to find a file and don't have the exact path, ALWAYS use dir_list or grep_search FIRST. NEVER guess file paths with file_read.
- If file_read returns ENOENT, STOP guessing. Use dir_list on the parent directory to find the correct path.
- NEVER try more than 2 file_read attempts without using dir_list first.

## CRITICAL — structural scan BEFORE editing
Before making ANY edit to a file, you MUST understand its structure:
1. **First read**: Read the first 50 lines to understand the file type, imports, and overall structure.
2. **Locate zones**: For large files (>200 lines), use grep_search to find key landmarks:
   - For HTML components: find \`<template>\`, \`<script>\`, \`properties:\`, \`@media print\`, the function you need to edit.
   - For JS files: find the class/function definition, exports, the method you need to change.
3. **Understand the context of your target line**: Before editing line N, read at least 50 lines around it (N-25 to N+25) to understand:
   - Are you inside a JS function? Inside a string concatenation? Inside HTML template markup?
   - What variables are available in this scope?
   - What is the surrounding code doing?
4. **Only then edit**: Now you have enough context to make a correct change.

NEVER jump directly to a line number and edit it without understanding what surrounds it.

## CRITICAL — editing existing files
- To modify existing files, ALWAYS use file_edit instead of file_write.
- file_edit has TWO modes:
  1. REPLACE: Use start_line + end_line + new_string to replace a range of lines.
  2. INSERT: Use start_line + new_string (WITHOUT end_line) to insert new lines AFTER that line.
- ALWAYS prefer INSERT mode when adding new fields/properties/lines. Only use REPLACE when you need to change existing lines.
- Workflow: 1) structural scan, 2) file_read target area with context, 3) file_edit, 4) file_read AGAIN to verify.
- To INSERT after line 875: file_edit({ path: "file.html", start_line: 875, new_string: "new lines" })
- To REPLACE lines 867-875: file_edit({ path: "file.html", start_line: 867, end_line: 875, new_string: "replacement" })
- NEVER use file_write to rewrite an entire large file.
- Only use file_write for creating NEW files that don't exist yet.

## CRITICAL — verify after EVERY edit
- After EVERY file_edit call, you MUST do file_read on the edited area (±10 lines) to verify the result.
- Check that: brackets/braces are balanced, the code structure makes sense, no lines were accidentally deleted.
- If the verification shows broken code, IMMEDIATELY fix it with another file_edit before proceeding.
- NEVER move on to the next edit without verifying the previous one.

## CRITICAL — safe editing rules
- When adding a new field to an object literal (like {a: 1, b: 2}), use INSERT to add a new line — do NOT replace existing lines.
- When adding a new HTML element, use INSERT after the element above it — do NOT replace existing elements.
- When modifying a function, read the ENTIRE function first (all lines from start to end) before editing. Understand the structure.
- NEVER replace lines that contain code you don't fully understand — you might break callbacks, closures, or control flow.
- If a function is complex (callbacks, promises, nested blocks), read at least 30 lines of context before and after your target.

## CRITICAL — file_write rules
- NEVER use escaped quotes (\\" or \\') inside file content. Use normal quotes: " and '
- After writing ANY code file (.tsx, .ts, .jsx, .js, .css, .html), ALWAYS read it back with file_read to verify it looks correct.
- If you see backslash-escaped quotes (\\" or \\') in the file content, REWRITE the file immediately with proper quotes.
- JSX example — CORRECT: <div className="flex"> — WRONG: <div className=\\"flex\\">
- This is the #1 cause of build errors. ALWAYS verify your writes.

## CRITICAL — Web Component / Polymer HTML files
When editing .html files that contain \`<dom-module>\`, \`<link rel="import">\`, or Polymer component definitions:

### File structure — understand the zones:
1. **Imports zone** (top): Only \`<link rel="import">\` tags. NEVER put HTML elements here.
2. **\`<dom-module>\` → \`<template>\`**: This is where HTML markup and \`<style>\` go.
3. **\`<script>\`**: This is where JS (Polymer({ ... })) goes — properties, observers, methods.

### Data binding rules:
- \`[[variable]]\` and \`{{variable}}\` are Polymer template binding syntax.
- They ONLY work inside the \`<template>\` section of the HTML.
- They NEVER work inside JavaScript strings. In JS, use \`this.variable\` instead.
- BAD: \`'<div>' + '[[nombre]]' + '</div>'\` → the literal text "[[nombre]]" will appear.
- GOOD: \`'<div>' + this.nombre + '</div>'\` → the actual value will appear.

### Common mistakes to AVOID:
- Putting \`<iron-ajax>\`, \`<paper-dialog>\`, or any element OUTSIDE of \`<template>\`. They MUST go inside.
- Using \`[[binding]]\` in JS string concatenation — use \`this.propertyName\` instead.
- Adding a property without initializing it (add an observer or set it in \`attached\`/\`ready\`).
- Adding elements in the imports section — imports are ONLY for \`<link rel="import">\`.

### When making a value dynamic in a print/HTML-string function:
1. First, ensure the property exists and is populated (check observers, attached, API calls).
2. In JS string concatenation, reference it as \`this.propertyName\`, NOT \`[[propertyName]]\`.
3. Example: \`'<div>' + this.nombreEmpresa + '</div>'\`

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
