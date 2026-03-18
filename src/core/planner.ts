import { ModelRouter } from "../models/router.js";
import { Message } from "../models/types.js";

export interface PlanStep {
  id: number;
  action: string;
  description: string;
  tools: string[];
  agent?: string; // If this step should be delegated to a sub-agent
  dependencies: number[]; // Step IDs that must complete first
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  result?: string;
}

export interface Plan {
  id: string;
  task: string;
  analysis: string;
  steps: PlanStep[];
  estimatedComplexity: string;
  suggestedModel: string;
  createdAt: Date;
  status: "draft" | "approved" | "running" | "completed" | "failed";
}

const PLANNING_PROMPT = `You are a task planner for an autonomous coding agent.

Given a task, create a detailed execution plan. Output ONLY valid JSON, no markdown fences.

Output format:
{
  "analysis": "Brief analysis of what needs to be done and potential challenges",
  "steps": [
    {
      "id": 1,
      "action": "short action name",
      "description": "detailed description of what to do",
      "tools": ["tool_names", "needed"],
      "agent": "optional: researcher|coder|installer|analyst if should be delegated",
      "dependencies": []
    }
  ],
  "estimatedComplexity": "simple|moderate|complex|expert",
  "suggestedModel": "model recommendation for execution"
}

Rules:
- Break complex tasks into small, independent steps where possible
- Mark steps that can run in parallel (no dependencies between them)
- Use "agent" field for steps that can be delegated to a sub-agent
- Be specific about which tools each step needs
- Consider error cases and include verification steps

Available tools: file_read, file_write, dir_list, bash_execute, web_fetch, web_search, grep_search, memory_save, memory_load, git_status, git_diff, git_log, git_commit, git_branch, project_info, create_tool, spawn_agent, run_background`;

export class Planner {
  private router: ModelRouter;

  constructor(router: ModelRouter) {
    this.router = router;
  }

  async createPlan(task: string, context?: string): Promise<Plan> {
    const messages: Message[] = [
      { role: "system", content: PLANNING_PROMPT },
      {
        role: "user",
        content: context
          ? `Context:\n${context}\n\nTask: ${task}`
          : `Task: ${task}`,
      },
    ];

    const response = await this.router.route(messages, undefined, { complexity: "moderate" });

    let planData: any;
    try {
      // Try to extract JSON from the response
      const jsonMatch = response.content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        planData = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in response");
      }
    } catch (err: any) {
      // Fallback: single-step plan
      planData = {
        analysis: "Could not generate detailed plan. Will execute directly.",
        steps: [
          {
            id: 1,
            action: "execute",
            description: task,
            tools: [],
            dependencies: [],
          },
        ],
        estimatedComplexity: "moderate",
        suggestedModel: "auto",
      };
    }

    const plan: Plan = {
      id: `plan_${Date.now()}`,
      task,
      analysis: planData.analysis || "",
      steps: (planData.steps || []).map((s: any, i: number) => ({
        id: s.id || i + 1,
        action: s.action || `step-${i + 1}`,
        description: s.description || "",
        tools: s.tools || [],
        agent: s.agent,
        dependencies: s.dependencies || [],
        status: "pending" as const,
      })),
      estimatedComplexity: planData.estimatedComplexity || "moderate",
      suggestedModel: planData.suggestedModel || "auto",
      createdAt: new Date(),
      status: "draft",
    };

    return plan;
  }

  formatPlanForDisplay(plan: Plan): string {
    const lines: string[] = [];
    lines.push(`📋 Plan: ${plan.task}`);
    lines.push(`   Complexity: ${plan.estimatedComplexity}`);
    lines.push(`   Analysis: ${plan.analysis}`);
    lines.push(`   Steps:`);

    for (const step of plan.steps) {
      const deps = step.dependencies.length > 0 ? ` (after: ${step.dependencies.join(", ")})` : " (parallel)";
      const agent = step.agent ? ` [→ ${step.agent} agent]` : "";
      const icons: Record<string, string> = {
        pending: "○",
        running: "◉",
        completed: "✅",
        failed: "❌",
        skipped: "⊘",
      };
      const icon = icons[step.status] || "?";
      lines.push(`   ${icon} ${step.id}. ${step.action}${deps}${agent}`);
      lines.push(`      ${step.description}`);
      if (step.tools.length > 0) {
        lines.push(`      Tools: ${step.tools.join(", ")}`);
      }
      if (step.result) {
        lines.push(`      Result: ${step.result}`);
      }
    }

    return lines.join("\n");
  }

  // Get steps that are ready to run (dependencies met)
  getReadySteps(plan: Plan): PlanStep[] {
    const completedIds = new Set(
      plan.steps.filter((s) => s.status === "completed").map((s) => s.id)
    );

    return plan.steps.filter((step) => {
      if (step.status !== "pending") return false;
      return step.dependencies.every((depId) => completedIds.has(depId));
    });
  }
}
