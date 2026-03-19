# Enforced Agent Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Force the scout→planner→developer pipeline in code so the LLM cannot skip steps, and auto-enrich scout tasks with keywords from the user message.

**Architecture:** Replace the current system where the orchestrator LLM decides which agents to spawn in which order. Instead, introduce a `Pipeline` class that manages the workflow as a state machine. The orchestrator gets a single `run_pipeline` tool that kicks off the full cycle. The pipeline extracts keywords from the user's message and auto-includes them in the scout's search task. The planner's output is validated for old_code/new_code pairs before the developer can run.

**Tech Stack:** TypeScript, existing SubAgent/TaskRunner infrastructure

---

## Problem Statement

The orchestrator (gemini flash lite) makes three critical mistakes that prompt engineering cannot fix:

1. **Skips scout/planner** — goes straight to developer with vague instructions
2. **Invents data sources** — assumes `this.session.nombre_sucursal` exists without checking
3. **Passes vague tasks to developer** — "replace ARTIKA with branch name" instead of exact code

These are not prompt problems. The LLM will always take shortcuts regardless of instructions. The solution is code that enforces the correct workflow.

## Design

```
User: "replace ARTIKA with sucursales.nombre_sucursal from mongo using CrudService"
                    │
                    ▼
         ┌──────────────────┐
         │  KEYWORD EXTRACT  │  (code, not LLM)
         │  → "ARTIKA"       │
         │  → "sucursales"   │
         │  → "nombre_sucursal"│
         │  → "CrudService"  │
         └────────┬─────────┘
                  ▼
         ┌──────────────────┐
         │  SCOUT (agent)   │  Task auto-includes:
         │  1. grep "ARTIKA"│  "Also search for: sucursales,
         │  2. grep CrudSvc │   nombre_sucursal, CrudService"
         │  3. report       │
         └────────┬─────────┘
                  │ output: files, lines, existing usage examples
                  ▼
         ┌──────────────────┐
         │  PLANNER (agent) │  Gets: scout report + user request
         │  Reads actual    │  Produces: old_code/new_code pairs
         │  code lines      │
         └────────┬─────────┘
                  │ output validated: must have ≥1 edit with old_code+new_code
                  ▼
         ┌──────────────────┐
         │  DEVELOPER (agent)│  Gets: list of file_edit instructions
         │  Executes edits  │  Cannot improvise — only runs edits
         │  Verifies each   │
         └────────┬─────────┘
                  │
                  ▼
         ┌──────────────────┐
         │  VERIFIER (agent)│  Reads modified files
         │  Reports PASS/FAIL│
         └──────────────────┘
```

## File Structure

- **Create:** `src/core/pipeline.ts` — The Pipeline class (state machine, keyword extraction, validation gates)
- **Modify:** `src/core/orchestrator.ts` — Add `run_pipeline` virtual tool, simplify prompt (remove workflow instructions that are now enforced by code)
- **Modify:** `src/core/agent-roles.ts` — Minor: planner output format enforcement

---

### Task 1: Create the Pipeline class

**Files:**
- Create: `src/core/pipeline.ts`

- [ ] **Step 1: Create pipeline.ts with types and keyword extractor**

```typescript
// src/core/pipeline.ts
import { SubAgent, SubAgentConfig, SubAgentResult } from "./sub-agent.js";
import { ToolRegistry } from "../tools/registry.js";
import { ModelRouter } from "../models/router.js";
import { TaskRunner } from "./task-runner.js";
import { AGENT_ROLES } from "./agent-roles.js";
import { EventEmitter } from "events";

export interface PipelineEdit {
  path: string;
  old_code: string;
  new_code: string;
}

export interface PipelineResult {
  success: boolean;
  stage: "scout" | "planner" | "developer" | "verifier" | "done";
  error?: string;
  scoutReport?: string;
  plannerEdits?: PipelineEdit[];
  developerOutput?: string;
  verifierOutput?: string;
}

/**
 * Extract keywords from user message that should be searched by the scout.
 * Looks for: identifiers (camelCase, snake_case), collection names, service names,
 * quoted strings, and technical terms.
 */
export function extractKeywords(userMessage: string): string[] {
  const keywords: string[] = [];
  const seen = new Set<string>();

  // Extract quoted strings
  const quoted = userMessage.match(/["']([^"']+)["']/g);
  if (quoted) {
    for (const q of quoted) {
      const clean = q.replace(/["']/g, "").trim();
      if (clean.length > 2 && !seen.has(clean.toLowerCase())) {
        seen.add(clean.toLowerCase());
        keywords.push(clean);
      }
    }
  }

  // Extract technical identifiers: camelCase, snake_case, PascalCase, dot.notation
  const identifiers = userMessage.match(/[A-Za-z_][A-Za-z0-9_.]*[A-Za-z0-9]/g) || [];
  // Common words to skip
  const stopWords = new Set([
    "the", "that", "this", "with", "from", "para", "como", "donde", "tiene",
    "debe", "esta", "ahi", "hay", "usar", "sale", "viene", "quiero", "tengo",
    "una", "unos", "unas", "del", "los", "las", "por", "pero", "con",
    "en", "de", "la", "el", "un", "es", "se", "no", "si", "ya", "al",
    "mongo", "mongodb", "html", "css", "file", "code", "line",
  ]);

  for (const id of identifiers) {
    const lower = id.toLowerCase();
    if (lower.length > 2 && !seen.has(lower) && !stopWords.has(lower)) {
      seen.add(lower);
      keywords.push(id);
    }
  }

  return keywords;
}

/**
 * Parse planner output to extract old_code/new_code edit pairs.
 * Looks for patterns like:
 *   old_code: ...
 *   new_code: ...
 * or:
 *   old_string: ...
 *   new_string: ...
 */
export function parsePlannerEdits(plannerOutput: string): PipelineEdit[] {
  const edits: PipelineEdit[] = [];

  // Split by "Change N" or "Edit N" or numbered items
  const sections = plannerOutput.split(/(?:^|\n)(?:Change|Edit|Cambio)?\s*\d+[.:)\-]/i);

  for (const section of sections) {
    if (!section.trim()) continue;

    // Find path
    const pathMatch = section.match(/(?:path|archivo|file)[:\s]+[`"']?([^\s`"'\n]+)[`"']?/i);

    // Find old_code / old_string
    const oldMatch = section.match(/(?:old_code|old_string|código actual|current)[:\s]*(?:```[^\n]*\n)?([\s\S]*?)(?=(?:new_code|new_string|código nuevo|replacement|```\s*$))/i);

    // Find new_code / new_string
    const newMatch = section.match(/(?:new_code|new_string|código nuevo|replacement)[:\s]*(?:```[^\n]*\n)?([\s\S]*?)(?=(?:Change|Edit|Cambio|\n\d+[.:)]|$))/i);

    if (pathMatch && oldMatch && newMatch) {
      const old_code = oldMatch[1].replace(/```\s*$/g, "").trim();
      const new_code = newMatch[1].replace(/```\s*$/g, "").trim();
      if (old_code && new_code) {
        edits.push({
          path: pathMatch[1],
          old_code,
          new_code,
        });
      }
    }
  }

  return edits;
}

export class Pipeline extends EventEmitter {
  private registry: ToolRegistry;
  private router: ModelRouter;
  private taskRunner: TaskRunner;

  constructor(registry: ToolRegistry, router: ModelRouter, taskRunner: TaskRunner) {
    super();
    this.registry = registry;
    this.router = router;
    this.taskRunner = taskRunner;
  }

  /**
   * Run the full pipeline: scout → planner → developer → verifier
   * Returns a PipelineResult at each stage.
   */
  async run(
    userMessage: string,
    onStage: (stage: string, message: string) => void,
    options?: { provider?: string; model?: string }
  ): Promise<PipelineResult> {

    // ─── STAGE 0: Extract keywords ──────────────────────────────────
    const keywords = extractKeywords(userMessage);
    const keywordNote = keywords.length > 0
      ? `\n\nAlso search the codebase for these terms (grep each one): ${keywords.join(", ")}`
      : "";

    onStage("scout", "Exploring codebase...");

    // ─── STAGE 1: Scout ─────────────────────────────────────────────
    const scoutRole = AGENT_ROLES.scout;
    const scoutTask = `${userMessage}${keywordNote}\n\nFor each keyword found, report: which file, which line, and a snippet of how it's used.`;

    const scoutResult = await this.runAgent("scout", scoutRole, scoutTask, options);
    if (!scoutResult.success) {
      return { success: false, stage: "scout", error: scoutResult.error || scoutResult.output };
    }

    onStage("planner", "Creating edit plan...");

    // ─── STAGE 2: Planner ───────────────────────────────────────────
    const plannerRole = AGENT_ROLES.planner;
    const plannerTask = `USER REQUEST: ${userMessage}

SCOUT REPORT:
${scoutResult.output}

Based on the scout report, produce EXACT edit instructions. For each change provide:
- path: the file to edit
- old_code: the EXACT current code (copy from scout report, include 2-3 surrounding lines for uniqueness)
- new_code: the exact replacement code`;

    const plannerResult = await this.runAgent("planner", plannerRole, plannerTask, options);
    if (!plannerResult.success) {
      return { success: false, stage: "planner", error: plannerResult.error || plannerResult.output };
    }

    // ─── GATE: Validate planner output ──────────────────────────────
    const edits = parsePlannerEdits(plannerResult.output);
    if (edits.length === 0) {
      return {
        success: false,
        stage: "planner",
        scoutReport: scoutResult.output,
        error: `Planner did not produce valid old_code/new_code pairs. Raw output: ${plannerResult.output.slice(0, 500)}`,
      };
    }

    onStage("developer", `Applying ${edits.length} edit(s)...`);

    // ─── STAGE 3: Developer ─────────────────────────────────────────
    const developerRole = AGENT_ROLES.developer;
    const editInstructions = edits.map((e, i) =>
      `Edit ${i + 1}:\n  file: ${e.path}\n  old_string: ${e.old_code}\n  new_string: ${e.new_code}`
    ).join("\n\n");

    const developerTask = `Execute these file edits using file_edit with old_string/new_string matching.
For each edit: 1) file_read to confirm old_string exists, 2) file_edit, 3) file_read to verify.

${editInstructions}`;

    const devResult = await this.runAgent("developer", developerRole, developerTask, options);
    if (!devResult.success) {
      return {
        success: false,
        stage: "developer",
        scoutReport: scoutResult.output,
        plannerEdits: edits,
        error: devResult.error || devResult.output,
      };
    }

    onStage("verifier", "Verifying changes...");

    // ─── STAGE 4: Verifier ──────────────────────────────────────────
    const verifierRole = AGENT_ROLES.verifier;
    const filesToCheck = [...new Set(edits.map(e => e.path))];
    const verifierTask = `Verify these files were edited correctly: ${filesToCheck.join(", ")}

Expected changes:
${edits.map((e, i) => `${i + 1}. In ${e.path}: "${e.old_code.slice(0, 80)}..." should now be "${e.new_code.slice(0, 80)}..."`).join("\n")}

Read each file and confirm the changes are correct. Report PASS or FAIL.`;

    const verifierResult = await this.runAgent("verifier", verifierRole, verifierTask, options);

    return {
      success: true,
      stage: "done",
      scoutReport: scoutResult.output,
      plannerEdits: edits,
      developerOutput: devResult.output,
      verifierOutput: verifierResult.output,
    };
  }

  private async runAgent(
    type: string,
    role: import("./agent-roles.js").AgentRole,
    task: string,
    options?: { provider?: string; model?: string }
  ): Promise<SubAgentResult> {
    const config: SubAgentConfig = {
      name: type,
      role: role.systemPrompt,
      tools: role.tools,
      provider: options?.provider,
      model: options?.model,
      maxIterations: role.maxIterations,
    };

    const agent = new SubAgent(config, this.registry, this.router);
    return agent.execute(task);
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors in src/core/pipeline.ts

- [ ] **Step 3: Commit**

```bash
git add src/core/pipeline.ts
git commit -m "feat: add Pipeline class with enforced scout→planner→developer→verifier flow"
```

---

### Task 2: Add run_pipeline tool to orchestrator

**Files:**
- Modify: `src/core/orchestrator.ts`

- [ ] **Step 1: Import Pipeline and add it to the Orchestrator constructor**

In orchestrator.ts, add import and create pipeline instance:
```typescript
// Add to imports (top of file)
import { Pipeline } from "./pipeline.js";

// Add to class properties (after private planner: Planner;)
private pipeline: Pipeline;

// Add to constructor (after this.planner = new Planner(router);)
this.pipeline = new Pipeline(registry, router, taskRunner);
```

- [ ] **Step 2: Add run_pipeline virtual tool definition**

Add to VIRTUAL_TOOLS array (before the closing `];`):
```typescript
  {
    name: "run_pipeline",
    description: "Run the full development pipeline: scout→planner→developer→verifier. Use this for ANY task that modifies existing code. You provide the user's request and it automatically: 1) explores the codebase (searching for keywords in the request), 2) creates exact edit instructions, 3) executes them, 4) verifies the result. This is BETTER than manually spawning scout/planner/developer because it enforces the correct workflow and prevents shortcuts.",
    parameters: {
      type: "object" as const,
      properties: {
        task: { type: "string", description: "The user's request exactly as they wrote it. Include all details about what to change, where to get data, what services to use." },
        provider: { type: "string", description: "Optional: force provider for all agents" },
        model: { type: "string", description: "Optional: force model for all agents" },
      },
      required: ["task"],
    },
  },
```

- [ ] **Step 3: Add handler in the tool dispatch switch**

In the `for (const tc of response.tool_calls)` loop, add before the `default:` case:
```typescript
            case "run_pipeline":
              result = await this.handleRunPipeline(tc.arguments);
              break;
```

- [ ] **Step 4: Implement handleRunPipeline method**

Add after handleSpawnFixedAgent:
```typescript
  private async handleRunPipeline(args: any): Promise<ToolResult> {
    const { task, provider, model } = args;

    if (!task) {
      return { success: false, error: "Task is required." };
    }

    if (this.config.autonomyLevel < 2 && this.config.confirmBeforeExec) {
      const confirmed = await this.config.confirmBeforeExec("run_pipeline", {
        task: task.slice(0, 200),
      });
      if (!confirmed) return { success: false, error: "User denied pipeline execution" };
    }

    // Run pipeline in background so orchestrator stays responsive
    const taskId = this.taskRunner.submit(
      "pipeline",
      `Pipeline: ${task.slice(0, 80)}`,
      async (progress) => {
        const result = await this.pipeline.run(
          task,
          (stage, message) => progress(`[${stage}] ${message}`),
          { provider, model }
        );
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
        message: `Pipeline started [${taskId}]. Stages: scout → planner → developer → verifier. You'll be notified when complete.`,
      },
    };
  }
```

- [ ] **Step 5: Add run_pipeline to describeToolCall and describeToolResult**

In describeToolCall, add case:
```typescript
      case "run_pipeline": return `▶ Pipeline: ${(a.task || "").slice(0, 80)}`;
```

In describeToolResult, add case:
```typescript
      case "run_pipeline": return `task ${result.data?.taskId || "?"}`;
```

- [ ] **Step 6: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 7: Commit**

```bash
git add src/core/orchestrator.ts
git commit -m "feat: add run_pipeline tool that enforces scout→planner→developer→verifier"
```

---

### Task 3: Simplify orchestrator prompt

**Files:**
- Modify: `src/core/orchestrator.ts`

- [ ] **Step 1: Replace the workflow section of the system prompt**

Find the section from `## YOUR WORKFLOW` through the end of `### CRITICAL: Don't ask, DO` and replace with:

```
## YOUR WORKFLOW

### When modifying EXISTING code:
Use run_pipeline — it handles everything automatically (scout, plan, edit, verify).
Just pass the user's request as the task. run_pipeline extracts keywords, searches the codebase,
creates exact edits, executes them, and verifies. You do NOT need to manually spawn scout/planner/developer.

### When building something NEW from scratch:
Use spawn_developer or spawn_installer directly.

### When the user reports a bug or error:
Use spawn_debugger with the error details.

### Don't ask, DO
- The user expects you to be an expert. Act like one.
- Don't ask for confirmation — explore, plan, execute.
```

- [ ] **Step 2: Remove the EXAMPLES section** (lines 113-123)

The examples reference the old manual workflow. Remove them.

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 4: Commit**

```bash
git add src/core/orchestrator.ts
git commit -m "refactor: simplify orchestrator prompt — run_pipeline handles workflow"
```

---

### Task 4: Update planner role to enforce output format

**Files:**
- Modify: `src/core/agent-roles.ts`

- [ ] **Step 1: Update planner systemPrompt with structured output format**

Replace planner systemPrompt with:
```
You are a PLANNER. Read code and produce EXACT edit instructions.

For each change, output in this EXACT format:

Change 1:
  path: exact/file/path.html
  old_code: [paste the EXACT current code from the file — include 2-3 surrounding lines for uniqueness]
  new_code: [the exact replacement — complete, correct, ready to paste]

Rules:
- Read the files yourself before writing old_code — copy the real code, don't guess.
- In JS strings ('<div>' + x), use variables like r.name — NEVER [[binding]].
- In HTML <template>, use [[variable]] — NEVER this.variable.
- NEVER modify files. Read only.
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/core/agent-roles.ts
git commit -m "feat: enforce structured output format for planner agent"
```
