import { EventEmitter } from "events";
import { ToolRegistry } from "../tools/registry.js";
import { ToolBuilder, ToolBlueprint } from "../tools/builder.js";
import { toolToDefinition, ToolResult } from "../tools/types.js";
import { ModelRouter } from "../models/router.js";
import { Message, ToolCall } from "../models/types.js";
import { TaskRunner } from "./task-runner.js";
import { SubAgent, SubAgentConfig } from "./sub-agent.js";
import { Planner, Plan } from "./planner.js";
import { AuditLog } from "./audit.js";
import { AGENT_ROLES, getAgentRole, listAgentRoles } from "./agent-roles.js";

export interface OrchestratorConfig {
  autonomyLevel: 0 | 1 | 2 | 3;
  maxIterations: number;
  verbose: boolean;
  confirmBeforeExec?: (toolName: string, args: Record<string, any>) => Promise<boolean>;
}

// Token usage tracking per LLM call
export interface TokenEntry {
  id: number;
  timestamp: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cost_usd: number;
  source: string; // "orchestrator" | agent name
}

// Pricing per 1M tokens (input/output) — with billing enabled, pay-as-you-go rates
// Pricing per 1M tokens (input/output)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Gemini
  "gemini-3.1-flash-lite-preview": { input: 0.075, output: 0.30 },
  "gemini-2.5-flash": { input: 0.15, output: 0.60 },
  "gemini-2.5-pro": { input: 1.25, output: 10.0 },
  // Claude
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-opus-4-6": { input: 15.0, output: 75.0 },
  "claude-haiku-4-5-20251001": { input: 0.80, output: 4.0 },
  // OpenAI
  "gpt-4o": { input: 2.50, output: 10.0 },
  "gpt-4o-mini": { input: 0.15, output: 0.60 },
  "o3-mini": { input: 1.10, output: 4.40 },
  // Deepseek
  "deepseek-chat": { input: 0.14, output: 0.28 },
  "deepseek-reasoner": { input: 0.55, output: 2.19 },
};

function buildSystemPrompt(toolList: string, taskSummary: string, availableProviders: string[] = [], failureSummary: string = ""): string {
  const providerNote = `\nAvailable providers: ${availableProviders.join(", ") || "none"}`;
  return `You are SamaraCode ⚡, an orchestrator agent.

## LANGUAGE
Always respond in the same language the user uses. If they write in Spanish, respond in Spanish. If English, respond in English.

## WHAT YOU ARE

You are a decisive senior engineer. You explore the codebase, understand the full picture, propose a complete plan, and execute it. You don't ask unnecessary questions — you read the code to find answers yourself.

## CRITICAL — TOOL CALLING

You MUST use actual function/tool calls to execute actions. NEVER describe or simulate tool calls in text.
When you want to spawn an agent, you MUST invoke the spawn_agent tool. Writing "spawn_agent(...)" in text does NOTHING.
When you want to run a command, you MUST invoke run_background. Just saying you'll run something does NOTHING.

## RULES

1. You are a MANAGER. You NEVER execute work directly. You DELEGATE everything to sub-agents via tool calls.
2. You NEVER use tools like file_read, file_write, bash_execute, web_search directly. Those are for sub-agents only.
3. You are ALWAYS available. You never block waiting for an agent.
4. Keep responses concise — no walls of text, no emoji spam, no markdown essays.
5. When the user says to start building, respond with a SHORT message AND make spawn_agent tool calls in the SAME response.
6. NEVER ask the user questions you could answer by reading the code.
7. Be DECISIVE — don't ask for confirmation at every step. Explore → Plan → Execute.

## YOUR WORKFLOW

### When building something NEW from scratch:
1. If the request is clear, START IMMEDIATELY — spawn agents to build
2. Only ask questions if there's genuine ambiguity (max 1-2 questions, not a list)

### When modifying EXISTING code:
1. spawn_scout → explore and report exact file paths, line numbers, current code
2. spawn_planner → read the actual code and produce EXACT file_edit instructions
3. spawn_developer → execute the planner's instructions (the developer should NOT think, only execute)

### CRITICAL: The planner produces the code, the developer just runs it
The planner's output must include for EACH change:
- file_edit({ path: "exact/path.html", start_line: N, end_line: M, new_string: "exact new code here" })
- The developer copies these instructions and executes them.
- The developer should NEVER need to figure out what code to write — the planner already wrote it.

Example planner output:
"Change 1: file_edit({ path: 'src/views/detalle.html', start_line: 2866, end_line: 2866, new_string: \"  '<div>' + r.sucursal_nombre + '</div>' +\" })
Change 2: file_edit({ path: 'src/views/detalle.html', start_line: 2743, end_line: 2743, new_string: \"  var mensaje = 'Hola ' + r.cliente.nombre + ' en ' + r.sucursal_nombre;\" })"

### CRITICAL: Developer gets exact edits, not vague instructions
- BAD task: "Replace ARTIKA with the branch name"
- GOOD task: "Execute these file_edits: 1) path=detalle.html start_line=2866 end_line=2866 new_string='..exact code..'"
- The developer is a cheap model. It cannot improvise. Give it EXACT code.

### CRITICAL: Don't ask, DO
- BAD: "I found the observer. What should I do?" → GOOD: spawn developer with exact changes
- BAD: "Do you want me to proceed?" → GOOD: "Here's the plan: [changes]. Spawning agents."
- BAD: "Which approach do you prefer?" → GOOD: pick the best approach and do it
- The user expects you to be an expert. Act like one.

## EXAMPLES

User: "quiero agregar niños extras al paquete de reservación"
You: "Exploring the codebase." [spawn scout agent] → scout returns → "Plan:
1. detalle.html line 45: add ninosExtra property
2. detalle.html line 2650: update _computeTotal to include extras
3. detalle.html line 800: add input UI
Implementing now." [spawn developer agent with full context]

User: "build me a task manager in React"
You: "Building a React task manager with CRUD and dark mode." [spawn agents immediately]

## SELF-REPAIR & ARCHITECTURE EVOLUTION

You can modify your own source code when you encounter limitations. This is your most powerful capability.

### When to self-repair:
1. **Sub-agent failure**: When an agent fails repeatedly at the same type of task, diagnose WHY and fix it.
2. **Missing capability**: When you can't do something the user needs, add the capability.
3. **Tool limitation**: When a built-in tool doesn't work correctly, fix it.
4. **System prompt gap**: When your instructions are missing something that causes failures, update them.

### Self-repair workflow:
1. **Diagnose**: When something fails, analyze the root cause. Is it a code bug? Missing tool? Prompt issue?
2. **Read**: Use self_read and self_list to understand the current code.
3. **Propose**: Use self_propose with the exact fix. Include clear description of what and why.
4. **Apply**: Use self_apply to apply the approved proposal.
5. **Verify**: After applying, test the fix by retrying the original task.

### Self-repair rules:
- ALWAYS diagnose before proposing — don't guess.
- ALWAYS use self_read first to get the exact current code.
- Prefer MINIMAL changes — fix the root cause, don't rewrite everything.
- When a sub-agent fails, first try retrying with better context. Only self-modify if the failure is structural.
- You can also use create_tool to add new capabilities without modifying source code.

### Failure recovery priority:
1. **Retry with better context** — the simplest fix is giving the agent more information
2. **Create a new tool** — if a capability is missing, create_tool is faster than self-modify
3. **Self-modify** — when the architecture itself is the problem (prompts, routing, tool logic)

## WHAT NOT TO DO
- NEVER ask "should I proceed?" — just do it after presenting the plan
- NEVER ask questions you could answer by reading the code
- NEVER make the developer agent search for files the scout already found
- NEVER present incomplete plans — include file paths and line numbers
- NEVER dump lists of your capabilities
- NEVER write walls of text
- NEVER use tools directly — always spawn agents
- NEVER ignore repeated failures — diagnose and fix the root cause

## TOOLS — FIXED AGENTS (use these first)

You have dedicated agent types for the full development cycle. Each has a proven role and the right tools — you only provide the task.

### Development cycle agents:
- **spawn_scout** — Explore code, map structure, report with exact paths and line numbers. ALWAYS start here when modifying existing code.
- **spawn_planner** — Create a step-by-step plan with exact files, lines, and code changes. Use after scout.
- **spawn_developer** — Implement changes following a plan. Give it exact instructions.
- **spawn_verifier** — Review code changes for correctness. Use AFTER developer finishes. Catches errors before the user sees them.
- **spawn_tester** — Run builds and tests. Use after developer or verifier.
- **spawn_debugger** — Diagnose and fix runtime errors, blank screens, broken functionality.
- **spawn_researcher** — Search web for docs, APIs, solutions.
- **spawn_installer** — Install dependencies, set up projects, create configs.

### Standard workflow for modifying existing code:
1. spawn_scout → find files, line numbers, current code
2. spawn_planner → read the code, produce EXACT file_edit instructions with the actual new code
3. spawn_developer → execute the file_edit instructions from the planner (developer does NOT write code, only runs edits)
4. spawn_verifier → check the changes are correct
5. If issues → spawn_debugger

### spawn_agent — CUSTOM agent (only when no fixed role fits)
- name: short name
- role: system prompt
- task: what to do
- tools: array of tool names
- Use ONLY for tasks that don't fit any fixed role above.

### COST OPTIMIZATION & MODEL SELECTION
Use the right model for each agent's task. By default, Gemini Flash is used for all tasks.
If Claude or GPT are configured, you can override with provider/model on any spawn tool for complex tasks.

### run_background — for shell commands (npm install, builds, tests)
- command: shell command
- name: descriptive name

### run_process — for dev servers and long-running processes
- command: e.g. "npm run dev"
- name: display name
- NOTE: When a dev server starts, a preview tab opens automatically in the UI when the URL is detected. You do NOT need to call open_preview manually for this.

### open_preview — open a live preview tab in the UI (only use when explicitly asked)
- url: the URL
- name: tab label
- Only use this when the user explicitly asks to open a specific URL. Do NOT call this after run_process — it's automatic.

### get_preview_errors — check the app preview for console errors
- No parameters. Returns captured browser errors from the running preview.
- Use this when the user says something like "it's blank", "doesn't work", "there's an error", "something's wrong".
- After getting errors, spawn a debug agent with tools: file_read, grep_search, file_write, dir_list to find and fix the bugs.

### create_tool — create new tools when needed
${ToolBuilder.getBlueprintSchema()}

### make_plan — for complex multi-step tasks, create a structured plan first

### Self-modification tools — for fixing yourself
- self_read: Read your own source code (e.g. self_read({ file: "src/core/orchestrator.ts" }))
- self_list: List your own source files (e.g. self_list({ dir: "src/tools" }))
- self_propose: Propose a code change to yourself (requires exact old_code/new_code match)
- self_apply: Apply a proposed change (always requires user confirmation)
Use these when you encounter a structural limitation you can't work around.

## STATE
${providerNote}
Tasks: ${taskSummary}
${failureSummary ? `Recent failures: ${failureSummary}` : ""}
Directory: ${process.cwd()}`;
}

// Build fixed agent spawn tools from AGENT_ROLES
const FIXED_AGENT_TOOLS = Object.entries(AGENT_ROLES).map(([key, role]) => ({
  name: `spawn_${key}`,
  description: `Spawn a ${key} agent: ${role.description}`,
  parameters: {
    type: "object" as const,
    properties: {
      task: { type: "string", description: "The specific task for this agent. Be detailed — include file paths, line numbers, and exact instructions." },
      provider: { type: "string", description: "Optional: force provider (claude, openai, deepseek, gemini, ollama)" },
      model: { type: "string", description: "Optional: force model name" },
    },
    required: ["task"],
  },
}));

const VIRTUAL_TOOLS = [
  ...FIXED_AGENT_TOOLS,
  {
    name: "create_tool",
    description: "Create a new dynamic tool from a blueprint. Built, auto-tested, and registered.",
    parameters: {
      type: "object" as const,
      properties: {
        blueprint: { type: "object", description: "Tool blueprint JSON" },
      },
      required: ["blueprint"],
    },
  },
  {
    name: "spawn_agent",
    description: "Spawn a CUSTOM sub-agent for tasks that don't fit the fixed roles (scout, planner, developer, verifier, tester, debugger, researcher, installer). Only use this when no fixed role applies.",
    parameters: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "Agent identifier" },
        role: { type: "string", description: "What this agent does (system prompt)" },
        task: { type: "string", description: "The specific task to execute" },
        tools: {
          type: "array",
          description: "Tool names this agent can use",
          items: { type: "string" },
        },
        provider: { type: "string", description: "Optional: force provider (claude, openai, deepseek, gemini, ollama)" },
        model: { type: "string", description: "Optional: force model name" },
      },
      required: ["name", "role", "task", "tools"],
    },
  },
  {
    name: "run_background",
    description: "Run a shell command in the background. Returns immediately with task ID. You'll be notified when it finishes.",
    parameters: {
      type: "object" as const,
      properties: {
        command: { type: "string", description: "Shell command to run" },
        name: { type: "string", description: "Descriptive name for this task" },
      },
      required: ["command", "name"],
    },
  },
  {
    name: "make_plan",
    description: "Create a structured execution plan for a complex task. Returns a plan with steps that can run in parallel or sequence. Use this for multi-step tasks before executing.",
    parameters: {
      type: "object" as const,
      properties: {
        task: { type: "string", description: "The task to plan for" },
        context: { type: "string", description: "Optional context about the current state" },
      },
      required: ["task"],
    },
  },
  {
    name: "run_process",
    description: "Start a long-running process like a dev server (npm run dev, npm start, etc.). The process runs persistently and shows in the sidebar. The user can see its output and kill it with a click. Use this for dev servers, watch modes, or any process that should keep running.",
    parameters: {
      type: "object" as const,
      properties: {
        command: { type: "string", description: "The command to run (e.g. 'npm run dev')" },
        name: { type: "string", description: "Display name (e.g. 'dev-server')" },
        cwd: { type: "string", description: "Working directory for the process" },
      },
      required: ["command", "name"],
    },
  },
  {
    name: "open_preview",
    description: "Open a URL preview tab in the UI. Use this after starting a dev server to show the user the running app. You can open multiple previews for different modules/ports. ALWAYS use this after run_process for dev servers.",
    parameters: {
      type: "object" as const,
      properties: {
        url: { type: "string", description: "The URL to preview (e.g. 'http://localhost:5173')" },
        name: { type: "string", description: "Tab label (e.g. 'Frontend', 'Admin Panel')" },
      },
      required: ["url", "name"],
    },
  },
  {
    name: "get_preview_errors",
    description: "Get console errors from the running app preview. Use this when the user reports issues like 'it's blank', 'it doesn't work', 'there's an error', etc. Returns browser console errors captured from the preview. After reading errors, spawn a debug agent to fix them.",
    parameters: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
];

export class Orchestrator extends EventEmitter {
  private registry: ToolRegistry;
  private builder: ToolBuilder;
  private router: ModelRouter;
  private config: OrchestratorConfig;
  private taskRunner: TaskRunner;
  private planner: Planner;
  private audit: AuditLog;
  private conversationHistory: Message[] = [];
  private pendingNotifications: string[] = [];
  private activePlan: Plan | null = null;
  private previewErrors: string[] = [];
  private tokenLog: TokenEntry[] = [];
  private tokenCounter = 0;
  private failureLog: { taskName: string; error: string; timestamp: Date }[] = [];
  private static readonly MAX_FAILURE_LOG = 50;
  private static readonly MAX_TOKEN_LOG = 500;

  constructor(
    registry: ToolRegistry,
    builder: ToolBuilder,
    router: ModelRouter,
    taskRunner: TaskRunner,
    config: OrchestratorConfig
  ) {
    super();
    this.registry = registry;
    this.builder = builder;
    this.router = router;
    this.taskRunner = taskRunner;
    this.config = config;
    this.planner = new Planner(router);
    this.audit = new AuditLog();
    this.audit.init().catch(() => {});

    // Listen for task completions
    this.taskRunner.on("task", (event) => {
      if (event.type === "completed") {
        const task = this.taskRunner.getTask(event.taskId);
        const raw = event.data?.output || event.data?.stdout || (event.data ? JSON.stringify(event.data) : "done");
        const output = typeof raw === "string" ? raw : JSON.stringify(raw);
        // Check if agent actually failed
        const failed = event.data?.error || event.data?.success === false;
        if (failed) {
          const errorMsg = event.data?.error || "agent could not find the files or complete the work";
          this.failureLog.push({ taskName: task?.name || "unknown", error: errorMsg, timestamp: new Date() });
          if (this.failureLog.length > Orchestrator.MAX_FAILURE_LOG) this.failureLog.shift();

          // Check for repeated failures — trigger self-diagnosis hint
          const recentFailures = this.failureLog.filter(f => Date.now() - f.timestamp.getTime() < 300000); // last 5 min
          const selfDiagnosisHint = recentFailures.length >= 2
            ? `\n⚠️ ${recentFailures.length} failures in the last 5 minutes. Consider diagnosing the root cause. You have self-repair tools (self_read, self_list, self_propose, self_apply) to fix structural issues, or create_tool to add missing capabilities.`
            : "";

          this.pendingNotifications.push(
            `❌ "${task?.name}" FAILED (hit max iterations without completing the task). Error: ${errorMsg}. Output: ${output.slice(0, 500)}${selfDiagnosisHint}`
          );
        } else {
          // Pass full output (up to 2000 chars) so orchestrator has real context for next agents
          this.pendingNotifications.push(
            `✅ "${task?.name}" completed. Full result:\n${output.slice(0, 2000)}`
          );
        }
      } else if (event.type === "failed") {
        const task = this.taskRunner.getTask(event.taskId);
        const errorMsg = typeof event.data === "string" ? event.data : JSON.stringify(event.data);
        this.failureLog.push({ taskName: task?.name || "unknown", error: errorMsg, timestamp: new Date() });

        const recentFailures = this.failureLog.filter(f => Date.now() - f.timestamp.getTime() < 300000);
        const selfDiagnosisHint = recentFailures.length >= 2
          ? `\n⚠️ Repeated failures detected. Use self-repair tools to diagnose and fix the root cause.`
          : "";

        this.pendingNotifications.push(
          `❌ "${task?.name}" failed: ${errorMsg}${selfDiagnosisHint}`
        );
      }
    });
  }

  async chat(userMessage: string): Promise<string> {
    // Inject any pending notifications
    if (this.pendingNotifications.length > 0) {
      const notifications = this.pendingNotifications.join("\n");
      this.pendingNotifications = [];
      this.conversationHistory.push({
        role: "user",
        content: `[SYSTEM NOTIFICATION]\n${notifications}\n\n[USER MESSAGE]\n${userMessage}`,
      });
    } else {
      this.conversationHistory.push({ role: "user", content: userMessage });
    }

    const taskSummary = this.taskRunner.getSummary();
    const recentFailures = this.failureLog.filter(f => Date.now() - f.timestamp.getTime() < 600000);
    const failureSummary = recentFailures.length > 0
      ? recentFailures.map(f => `${f.taskName}: ${f.error}`).join("; ")
      : "";
    const systemPrompt = buildSystemPrompt(this.registry.listForLLM(), taskSummary, this.router.getAvailableProviders().map(p => p.name), failureSummary);

    const messages: Message[] = [
      { role: "system", content: systemPrompt },
      ...this.conversationHistory,
    ];

    const tools = [
      ...this.registry.getAll().map(toolToDefinition),
      ...VIRTUAL_TOOLS,
    ];

    if (this.config.verbose) {
      const info = this.router.getRoutingInfo(userMessage);
      // Orchestrator always uses complex routing
      const rule = (this.router as any).config?.routing?.complex;
      const model = rule?.model || info.model;
      const provider = rule?.provider || info.provider;
      console.log(`  ⚡ ${provider}/${model} (orchestrator)`);
    }

    let iterations = 0;

    let consecutiveErrors = 0;

    while (iterations < this.config.maxIterations) {
      iterations++;

      let response;
      try {
        response = await this.router.route(messages, tools, { complexity: "complex" });
        consecutiveErrors = 0;
      } catch (err: any) {
        consecutiveErrors++;
        if (this.config.verbose) {
          console.log(`  ⚠ LLM error: ${err.message}`);
        }
        if (consecutiveErrors >= 3) {
          this.conversationHistory.push({
            role: "assistant",
            content: `I encountered repeated errors calling the LLM: ${err.message}. Please check your API key or try again.`,
          });
          return `Error: ${err.message}. Check your API key and connection.`;
        }
        // Wait briefly and retry
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }

      if (response.usage) {
        const entry = this.trackTokens(response.model, response.usage, "orchestrator");
        if (this.config.verbose) {
          console.log(`  ↳ ${entry.total_tokens} tokens ($${entry.cost_usd.toFixed(6)})`);
        }
      }

      if (!response.tool_calls || response.tool_calls.length === 0) {
        this.conversationHistory.push({ role: "assistant", content: response.content });
        return response.content;
      }

      // Show what the LLM is thinking if it has text before tool calls
      if (response.content && response.content.trim()) {
        console.log(`  💭 ${response.content}`);
      }

      const assistantMsg: Message = {
        role: "assistant",
        content: response.content,
        tool_calls: response.tool_calls,
      };
      messages.push(assistantMsg);
      this.conversationHistory.push(assistantMsg);

      for (const tc of response.tool_calls) {
        if (this.config.verbose) {
          console.log(`  ${this.describeToolCall(tc)}`);
        }

        let result: ToolResult;

        try {
          // Check if it's a fixed agent spawn (spawn_scout, spawn_developer, etc.)
          const fixedAgentMatch = tc.name.match(/^spawn_(.+)$/);
          const fixedRole = fixedAgentMatch ? getAgentRole(fixedAgentMatch[1]) : null;

          if (fixedRole) {
            result = await this.handleSpawnFixedAgent(fixedAgentMatch![1], fixedRole, tc.arguments);
          } else switch (tc.name) {
            case "create_tool":
              result = await this.handleCreateTool(tc.arguments);
              break;
            case "spawn_agent":
              result = await this.handleSpawnAgent(tc.arguments);
              break;
            case "run_background":
              result = await this.handleRunBackground(tc.arguments);
              break;
            case "make_plan":
              result = await this.handleMakePlan(tc.arguments);
              break;
            case "run_process":
              result = await this.handleRunProcess(tc.arguments);
              break;
            case "open_preview":
              result = this.handleOpenPreview(tc.arguments);
              break;
            case "get_preview_errors":
              result = this.handleGetPreviewErrors();
              break;
            case "self_apply":
              result = await this.handleSelfApply(tc);
              break;
            case "self_propose":
              result = await this.handleSelfPropose(tc);
              break;
            default:
              result = await this.executeWithSafety(tc);
          }
        } catch (err: any) {
          // Never crash — feed errors back to the LLM so it can recover
          result = {
            success: false,
            error: `Internal error: ${err.message}. Please try a different approach or fix the issue.`,
          };
          if (this.config.verbose) {
            console.log(`    ⚠ Internal error caught: ${err.message}`);
          }
        }

        // Audit log
        this.audit.log({
          type: "tool_call",
          actor: "orchestrator",
          action: tc.name,
          details: { args: tc.arguments, result: { success: result.success, error: result.error } },
          success: result.success,
        }).catch(() => {});

        if (this.config.verbose) {
          const icon = result.success ? "✓" : "✗";
          console.log(`    ${icon} ${this.describeToolResult(tc.name, result)}`);
        }

        const toolMsg: Message = {
          role: "tool",
          content: JSON.stringify(result),
          tool_call_id: tc.id,
        };
        messages.push(toolMsg);
        this.conversationHistory.push(toolMsg);
      }

      // Refresh system prompt (tools may have changed, failures may have occurred)
      const updatedFailures = this.failureLog.filter(f => Date.now() - f.timestamp.getTime() < 600000);
      const updatedFailureSummary = updatedFailures.length > 0
        ? updatedFailures.map(f => `${f.taskName}: ${f.error}`).join("; ")
        : "";
      messages[0] = {
        role: "system",
        content: buildSystemPrompt(this.registry.listForLLM(), this.taskRunner.getSummary(), this.router.getAvailableProviders().map(p => p.name), updatedFailureSummary),
      };
    }

    return "[max iterations reached — task may be incomplete]";
  }

  private async handleCreateTool(rawBlueprint: any): Promise<ToolResult> {
    // The LLM might send the blueprint in different shapes — normalize it
    let bp: ToolBlueprint;
    try {
      bp = this.normalizeBlueprint(rawBlueprint);
    } catch (err: any) {
      return { success: false, error: `Invalid blueprint: ${err.message}` };
    }

    if (this.config.autonomyLevel < 2 && this.config.confirmBeforeExec) {
      const desc = `Create tool "${bp.name}" (deps: ${bp.dependencies?.join(", ") || "none"})`;
      const confirmed = await this.config.confirmBeforeExec("create_tool", { description: desc });
      if (!confirmed) return { success: false, error: "User denied tool creation" };
    }

    const result = await this.builder.buildFromBlueprint(bp);
    if (result.success) {
      return { success: true, data: { message: `Tool "${bp.name}" created and registered.`, tests: result.testResults } };
    }
    return { success: false, error: result.error, data: { tests: result.testResults } };
  }

  private normalizeBlueprint(raw: any): ToolBlueprint {
    if (!raw || typeof raw !== "object") {
      throw new Error("Blueprint must be an object");
    }

    // If it's wrapped in a "blueprint" key, unwrap
    const bp = raw.blueprint || raw;

    // If it's a JSON string, parse it
    const data = typeof bp === "string" ? JSON.parse(bp) : bp;

    if (!data.name || typeof data.name !== "string") {
      throw new Error("Blueprint must have a 'name' string field");
    }
    if (!data.code || typeof data.code !== "string") {
      throw new Error("Blueprint must have a 'code' string field");
    }

    return {
      name: data.name,
      description: data.description || data.name,
      category: data.category || "custom",
      parameters: Array.isArray(data.parameters) ? data.parameters : [],
      dependencies: Array.isArray(data.dependencies) ? data.dependencies : [],
      code: data.code,
      testCases: Array.isArray(data.testCases || data.tests || data.test_cases)
        ? (data.testCases || data.tests || data.test_cases)
        : [],
    };
  }

  private async handleSpawnAgent(args: any): Promise<ToolResult> {
    const { name, role, task, tools, provider, model } = args;

    if (this.config.autonomyLevel < 2 && this.config.confirmBeforeExec) {
      const confirmed = await this.config.confirmBeforeExec("spawn_agent", {
        name,
        tools: tools?.join(", "),
        task: task?.slice(0, 100),
      });
      if (!confirmed) return { success: false, error: "User denied agent spawn" };
    }

    const agentConfig: SubAgentConfig = {
      name,
      role,
      tools: tools || ["file_read", "dir_list"],
      provider,
      model,
    };

    const resolvedProvider = provider || "gemini";
    const resolvedModel = model || undefined;

    const taskId = this.taskRunner.submit(
      name,
      `Sub-agent: ${task.slice(0, 100)}`,
      async (progress) => {
        const agent = new SubAgent(agentConfig, this.registry, this.router);
        const result = await agent.execute(task, progress);
        return result;
      }
    );

    // Set model info on the task for UI display
    const taskObj = this.taskRunner.getTask(taskId);
    if (taskObj) {
      taskObj.provider = provider || "gemini";
      taskObj.model = model || "";
    }

    return {
      success: true,
      data: {
        taskId,
        message: `Agent "${name}" spawned as background task [${taskId}]. You'll be notified when it completes.`,
      },
    };
  }

  private async handleSpawnFixedAgent(type: string, role: import("./agent-roles.js").AgentRole, args: any): Promise<ToolResult> {
    const { task, provider, model } = args;

    if (!task) {
      return { success: false, error: "Task is required for fixed agent spawn." };
    }

    if (this.config.autonomyLevel < 2 && this.config.confirmBeforeExec) {
      const confirmed = await this.config.confirmBeforeExec(`spawn_${type}`, {
        name: type,
        tools: role.tools.join(", "),
        task: task?.slice(0, 100),
      });
      if (!confirmed) return { success: false, error: "User denied agent spawn" };
    }

    const agentConfig: SubAgentConfig = {
      name: type,
      role: role.systemPrompt,
      tools: role.tools,
      provider,
      model,
      maxIterations: role.maxIterations,
    };

    const taskId = this.taskRunner.submit(
      type,
      `${type}: ${task.slice(0, 100)}`,
      async (progress) => {
        const agent = new SubAgent(agentConfig, this.registry, this.router);
        const result = await agent.execute(task, progress);
        return result;
      }
    );

    const taskObj = this.taskRunner.getTask(taskId);
    if (taskObj) {
      taskObj.provider = provider || "gemini";
      taskObj.model = model || "";
    }

    return {
      success: true,
      data: {
        taskId,
        message: `${type} agent spawned [${taskId}]. You'll be notified when it completes.`,
      },
    };
  }

  private async handleRunBackground(args: any): Promise<ToolResult> {
    const { command, name } = args;

    if (this.config.autonomyLevel < 2 && this.config.confirmBeforeExec) {
      const confirmed = await this.config.confirmBeforeExec("run_background", { command, name });
      if (!confirmed) return { success: false, error: "User denied" };
    }

    const { exec } = await import("child_process");
    const { promisify } = await import("util");
    const execAsync = promisify(exec);

    const taskId = this.taskRunner.submit(
      name,
      `Background: ${command.slice(0, 100)}`,
      async (progress) => {
        progress("executing...");
        const { stdout, stderr } = await execAsync(command, {
          cwd: process.cwd(),
          timeout: 300000, // 5 min max
          maxBuffer: 1024 * 1024 * 10,
        });
        return { stdout: stdout.trim(), stderr: stderr.trim() };
      }
    );

    return {
      success: true,
      data: {
        taskId,
        message: `Command running in background [${taskId}]. I'll notify when done.`,
      },
    };
  }

  private async executeWithSafety(toolCall: ToolCall): Promise<ToolResult> {
    const { name, arguments: args } = toolCall;
    const riskyTools = ["bash_execute", "file_write"];

    if (this.config.autonomyLevel === 0 && this.config.confirmBeforeExec) {
      const confirmed = await this.config.confirmBeforeExec(name, args);
      if (!confirmed) return { success: false, error: "User denied execution" };
    } else if (this.config.autonomyLevel === 1 && riskyTools.includes(name) && this.config.confirmBeforeExec) {
      const confirmed = await this.config.confirmBeforeExec(name, args);
      if (!confirmed) return { success: false, error: "User denied execution" };
    }

    return this.registry.execute(name, args);
  }

  private describeToolCall(tc: ToolCall): string {
    const a = tc.arguments;
    switch (tc.name) {
      case "file_read": return `📄 Reading ${a.path}`;
      case "file_write": return `✎ Writing ${a.path} (${a.content?.length || 0} chars)`;
      case "dir_list": return `📂 Listing ${a.path || "."}`;
      case "bash_execute": return `$ ${(a.command || "").slice(0, 100)}`;
      case "web_search": return `🔍 Searching: "${a.query}"`;
      case "web_fetch": return `🌐 Fetching ${a.url}`;
      case "grep_search": return `🔎 Grep "${a.pattern}" in ${a.path || "."}`;
      case "memory_save": return `💾 Saving memory: ${a.key}`;
      case "memory_load": return `📎 Loading memory: ${a.key || "all"}`;
      case "git_status": return `⎇ git status`;
      case "git_diff": return `⎇ git diff${a.staged ? " --staged" : ""}`;
      case "git_log": return `⎇ git log -${a.count || 10}`;
      case "git_commit": return `⎇ git commit: "${a.message}"`;
      case "git_branch": return `⎇ git branch ${a.action || "list"}`;
      case "project_info": return `📋 Scanning project at ${a.path || "."}`;
      case "create_tool": return `🔨 Creating tool: "${a.blueprint?.name || "?"}"`;
      case "spawn_agent": return `◆ Spawning custom agent: "${a.name}" → ${a.task || ""}`;
      case "run_background": return `⟳ Background: "${a.name}" → ${a.command || ""}`;
      case "make_plan": return `▦ Planning: ${a.task || ""}`;
      case "run_process": return `▶ Process: "${a.name}" → ${a.command || ""}`;
      case "open_preview": return `🌐 Preview: "${a.name}" → ${a.url || ""}`;
      case "get_preview_errors": return `🐛 Checking preview for errors`;
      case "self_read": return `🔍 Reading own source: ${a.file}`;
      case "self_list": return `📂 Listing own source: ${a.dir || "src"}`;
      case "self_propose": return `⚡ Proposing self-modification: ${a.description || ""}`;
      case "self_apply": return `⚡ Applying self-modification: ${a.proposal_id}`;
      default: {
        // Handle fixed agent spawns (spawn_scout, spawn_developer, etc.)
        if (tc.name.startsWith("spawn_") && getAgentRole(tc.name.replace("spawn_", ""))) {
          const type = tc.name.replace("spawn_", "");
          return `◆ Spawning ${type}: ${(a.task || "").slice(0, 80)}`;
        }
        return `⚙ ${tc.name}`;
      }
    }
  }

  private describeToolResult(name: string, result: ToolResult): string {
    if (!result.success) return result.error || "failed";

    switch (name) {
      case "file_read": return `${(result.data || "").length} chars read`;
      case "file_write": return "written";
      case "dir_list": return `${result.data?.length || 0} entries`;
      case "bash_execute": {
        const out = result.data?.stdout || "";
        return out.length > 100 ? out.slice(0, 100) + "..." : out || "(no output)";
      }
      case "web_search": return `${result.data?.count || 0} results`;
      case "web_fetch": return `${result.data?.status || "?"} (${result.data?.body?.length || 0} chars)`;
      case "grep_search": return `${result.data?.count || 0} matches`;
      case "git_status": return `branch: ${result.data?.branch || "?"}`;
      case "git_log": return `${result.data?.count || 0} commits`;
      case "spawn_agent": return `task ${result.data?.taskId || "?"}`;
      case "run_background": return `task ${result.data?.taskId || "?"}`;
      case "make_plan": return `${result.data?.steps?.length || 0} steps`;
      case "run_process": return `started (${result.data?.taskId || "?"})`;
      case "open_preview": return result.data?.message || "opened";
      case "get_preview_errors": return `${result.data?.count || 0} errors`;
      case "self_read": return `${result.data?.lines || 0} lines`;
      case "self_list": return `${result.data?.count || 0} files`;
      case "self_propose": return `proposal ${result.data?.proposalId || "?"}`;
      case "self_apply": return result.data?.message || "applied";
      default: return "done";
    }
  }

  private async handleSelfPropose(tc: ToolCall): Promise<ToolResult> {
    const args = tc.arguments;
    // Always show the proposal to the user, even in auto-accept mode
    console.log(`\n  ╭─── Self-improvement proposal ───╮`);
    console.log(`  │ File: ${args.file}`);
    console.log(`  │ ${args.description}`);
    console.log(`  ├─── Remove ───`);
    const oldLines = (args.old_code || "").split("\n");
    for (const line of oldLines.slice(0, 20)) {
      console.log(`  │ - ${line}`);
    }
    if (oldLines.length > 20) console.log(`  │ ... (${oldLines.length - 20} more lines)`);
    console.log(`  ├─── Add ───`);
    const newLines = (args.new_code || "").split("\n");
    for (const line of newLines.slice(0, 20)) {
      console.log(`  │ + ${line}`);
    }
    if (newLines.length > 20) console.log(`  │ ... (${newLines.length - 20} more lines)`);
    console.log(`  ╰────────────────────────────────╯\n`);

    // Execute the proposal (it just saves, doesn't modify)
    return this.registry.execute(tc.name, args);
  }

  private async handleSelfApply(tc: ToolCall): Promise<ToolResult> {
    // ALWAYS require confirmation for self_apply — never auto-accept
    if (!this.config.confirmBeforeExec) {
      return { success: false, error: "Self-modification requires confirmation handler." };
    }

    // Read the proposal to show it
    const proposalId = tc.arguments.proposal_id;
    const fs = await import("fs/promises");
    const path = await import("path");

    let proposal: any;
    try {
      const srcDir = path.resolve(new URL(".", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1"), "..");
      const proposalPath = path.join(srcDir, "data", "proposals", `${proposalId}.json`);
      proposal = JSON.parse(await fs.readFile(proposalPath, "utf-8"));
    } catch {
      return { success: false, error: `Proposal "${proposalId}" not found.` };
    }

    console.log(`\n  ╭─── ⚡ SELF-MODIFICATION ───╮`);
    console.log(`  │ File: ${proposal.file}`);
    console.log(`  │ ${proposal.description}`);
    console.log(`  ├─── Code to remove ───`);
    for (const line of proposal.old_code.split("\n").slice(0, 30)) {
      console.log(`  │ \x1b[31m- ${line}\x1b[0m`);
    }
    console.log(`  ├─── Code to add ───`);
    for (const line of proposal.new_code.split("\n").slice(0, 30)) {
      console.log(`  │ \x1b[32m+ ${line}\x1b[0m`);
    }
    console.log(`  ╰──────────────────────────╯\n`);

    const confirmed = await this.config.confirmBeforeExec("⚡ SELF-MODIFY", {
      description: `Apply self-modification: ${proposal.description}`,
      file: proposal.file,
    });

    if (!confirmed) {
      return { success: false, error: "User rejected self-modification." };
    }

    return this.registry.execute(tc.name, tc.arguments);
  }

  private async handleRunProcess(args: any): Promise<ToolResult> {
    const { command, name, cwd } = args;

    if (this.config.autonomyLevel < 2 && this.config.confirmBeforeExec) {
      const confirmed = await this.config.confirmBeforeExec("run_process", { command, name });
      if (!confirmed) return { success: false, error: "User denied" };
    }

    const taskId = this.taskRunner.spawnProcess(name, command, cwd);
    return {
      success: true,
      data: {
        taskId,
        message: `Process "${name}" started. It's visible in the sidebar. User can click to see output or kill it.`,
      },
    };
  }

  private handleGetPreviewErrors(): ToolResult {
    // Collect errors from two sources:
    // 1. Browser errors pushed via preview postMessage (if proxy was used)
    // 2. Dev server process output (compilation errors, warnings)
    const allErrors: string[] = [...this.previewErrors];
    this.previewErrors = [];

    // Check all running process tasks for error output
    const tasks = this.taskRunner.getAll();
    for (const task of tasks) {
      if (task.type === "process" && task.outputLines) {
        for (const line of task.outputLines) {
          const clean = line.replace(/\x1b\[[0-9;]*m/g, "");
          if (/error|Error|ERROR|failed|Failed|FAIL|Cannot find|is not defined|Unexpected token|SyntaxError|TypeError|ReferenceError/i.test(clean)) {
            allErrors.push(`[${task.name}] ${clean}`);
          }
        }
      }
    }

    if (allErrors.length === 0) {
      return { success: true, data: { count: 0, message: "No errors found in dev server output or browser console. The app might be working fine. If the user sees a blank page, the issue might be in the app logic — spawn a scout agent to read the main entry file and components." } };
    }

    // Deduplicate
    const unique = [...new Set(allErrors)].slice(-30);
    return {
      success: true,
      data: {
        count: unique.length,
        errors: unique,
        message: `${unique.length} errors found. Spawn a debug agent with tools: file_read, grep_search, file_write to find and fix these issues.`,
      },
    };
  }

  private handleOpenPreview(args: any): ToolResult {
    const { url, name } = args;
    this.emit("ui", { type: "open_preview", url, name });
    return {
      success: true,
      data: { message: `Preview "${name}" opened at ${url}` },
    };
  }

  private async handleMakePlan(args: any): Promise<ToolResult> {
    const { task, context } = args;
    try {
      const plan = await this.planner.createPlan(task, context);
      this.activePlan = plan;
      this.audit.log({
        type: "plan_created",
        actor: "orchestrator",
        action: "make_plan",
        details: { planId: plan.id, steps: plan.steps.length },
      }).catch(() => {});
      return {
        success: true,
        data: {
          planId: plan.id,
          display: this.planner.formatPlanForDisplay(plan),
          steps: plan.steps,
          complexity: plan.estimatedComplexity,
        },
      };
    } catch (err: any) {
      return { success: false, error: `Planning failed: ${err.message}` };
    }
  }

  getActivePlan(): Plan | null {
    return this.activePlan;
  }

  getAudit(): AuditLog {
    return this.audit;
  }

  // Check for completed background tasks (call periodically or before each prompt)
  getNotifications(): string[] {
    const notifs = [...this.pendingNotifications];
    this.pendingNotifications = [];
    return notifs;
  }

  resetHistory(): void {
    this.conversationHistory = [];
  }

  getHistory(): Message[] {
    return [...this.conversationHistory];
  }

  getTaskRunner(): TaskRunner {
    return this.taskRunner;
  }

  pushPreviewError(error: string): void {
    this.previewErrors.push(error);
    if (this.previewErrors.length > 50) this.previewErrors.shift();
  }

  trackTokens(model: string, usage: { input_tokens: number; output_tokens: number }, source: string): TokenEntry {
    const pricing = MODEL_PRICING[model] || { input: 0, output: 0 };
    const cost = (usage.input_tokens * pricing.input + usage.output_tokens * pricing.output) / 1_000_000;
    const entry: TokenEntry = {
      id: ++this.tokenCounter,
      timestamp: new Date().toISOString(),
      model,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      total_tokens: usage.input_tokens + usage.output_tokens,
      cost_usd: cost,
      source,
    };
    this.tokenLog.push(entry);
    if (this.tokenLog.length > Orchestrator.MAX_TOKEN_LOG) this.tokenLog.shift();
    this.emit("token_update", entry);
    return entry;
  }

  getTokenLog(): TokenEntry[] {
    return [...this.tokenLog];
  }

  getFailureLog(): { taskName: string; error: string; timestamp: Date }[] {
    return [...this.failureLog];
  }

  clearFailureLog(): void {
    this.failureLog = [];
  }

  getTokenSummary(): { total_input: number; total_output: number; total_tokens: number; total_cost: number; entries: number } {
    let total_input = 0, total_output = 0, total_cost = 0;
    for (const e of this.tokenLog) {
      total_input += e.input_tokens;
      total_output += e.output_tokens;
      total_cost += e.cost_usd;
    }
    return {
      total_input,
      total_output,
      total_tokens: total_input + total_output,
      total_cost,
      entries: this.tokenLog.length,
    };
  }
}
