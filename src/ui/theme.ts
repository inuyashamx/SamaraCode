import chalk from "chalk";

// ⚡ SamaraCode color palette
export const t = {
  // Brand
  brand: chalk.hex("#FFD700"),        // Gold — samaracode energy
  brandDim: chalk.hex("#B8960C"),
  bolt: chalk.hex("#FFD700")("⚡"),

  // Roles
  user: chalk.hex("#61AFEF"),          // Blue
  agent: chalk.hex("#C678DD"),         // Purple
  system: chalk.hex("#56B6C2"),        // Cyan
  tool: chalk.hex("#E5C07B"),          // Yellow
  success: chalk.hex("#98C379"),       // Green
  error: chalk.hex("#E06C75"),         // Red
  warning: chalk.hex("#D19A66"),       // Orange
  dim: chalk.gray,
  muted: chalk.hex("#5C6370"),

  // Semantic
  file: chalk.hex("#61AFEF"),
  cmd: chalk.hex("#E5C07B"),
  key: chalk.hex("#C678DD"),
  value: chalk.hex("#98C379"),
  url: chalk.hex("#61AFEF").underline,
  number: chalk.hex("#D19A66"),
};

// Box drawing
export const box = {
  tl: "╭", tr: "╮", bl: "╰", br: "╯",
  h: "─", v: "│",
  ltee: "├", rtee: "┤",
  cross: "┼",
};

export function drawBox(title: string, content: string[], width: number = 50): string {
  const innerW = width - 2;
  const lines: string[] = [];

  // Top
  const titleStr = title ? ` ${title} ` : "";
  const topPad = innerW - titleStr.length;
  lines.push(t.brandDim(box.tl + box.h + titleStr + box.h.repeat(Math.max(0, topPad - 1)) + box.tr));

  // Content
  for (const line of content) {
    const stripped = stripAnsi(line);
    const pad = Math.max(0, innerW - stripped.length);
    lines.push(t.brandDim(box.v) + " " + line + " ".repeat(pad) + t.brandDim(box.v));
  }

  // Bottom
  lines.push(t.brandDim(box.bl + box.h.repeat(innerW) + box.br));

  return lines.join("\n");
}

export function drawDivider(width: number = 50): string {
  return t.muted(box.h.repeat(width));
}

// Strip ANSI codes for length calculation
function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*[a-zA-Z]/g, "").replace(/\x1B\].*?\x07/g, "");
}

// Format a key-value pair
export function kv(key: string, value: string): string {
  return `${t.dim(key + ":")} ${value}`;
}

// Task/agent status icons
export const icons = {
  running: chalk.hex("#61AFEF")("◉"),
  pending: chalk.gray("○"),
  completed: chalk.hex("#98C379")("✓"),
  failed: chalk.hex("#E06C75")("✗"),
  cancelled: chalk.gray("⊘"),
  tool: chalk.hex("#E5C07B")("⚙"),
  agent: chalk.hex("#C678DD")("◆"),
  search: chalk.hex("#61AFEF")("⊕"),
  write: chalk.hex("#98C379")("✎"),
  read: chalk.hex("#56B6C2")("◇"),
  bash: chalk.hex("#D19A66")("$"),
  memory: chalk.hex("#C678DD")("☍"),
  git: chalk.hex("#E06C75")("⎇"),
  plan: chalk.hex("#FFD700")("▦"),
  bg: chalk.hex("#56B6C2")("⟳"),
};

// Get icon for a tool name
export function toolIcon(name: string): string {
  if (name.startsWith("file_read") || name === "dir_list" || name === "grep_search") return icons.read;
  if (name.startsWith("file_write")) return icons.write;
  if (name.startsWith("web_")) return icons.search;
  if (name === "bash_execute") return icons.bash;
  if (name.startsWith("memory_")) return icons.memory;
  if (name.startsWith("git_")) return icons.git;
  if (name === "create_tool") return icons.tool;
  if (name === "spawn_agent") return icons.agent;
  if (name === "run_background") return icons.bg;
  if (name === "make_plan") return icons.plan;
  return icons.tool;
}
