import { ToolRegistry } from "../registry.js";
import { fileReadTool } from "./file-read.js";
import { fileWriteTool } from "./file-write.js";
import { dirListTool } from "./dir-list.js";
import { bashExecuteTool } from "./bash-execute.js";
import { webFetchTool } from "./web-fetch.js";
import { webSearchTool } from "./web-search.js";
import { grepSearchTool } from "./grep-search.js";
import { memorySaveTool, memoryLoadTool } from "./memory.js";
import { projectInfoTool } from "./project.js";
import { gitStatusTool, gitDiffTool, gitLogTool, gitCommitTool, gitBranchTool } from "./git.js";
import { selfReadTool, selfListTool, selfProposeTool, selfApplyTool } from "./self-improve.js";

export function registerBuiltinTools(registry: ToolRegistry): void {
  registry.register(fileReadTool);
  registry.register(fileWriteTool);
  registry.register(dirListTool);
  registry.register(bashExecuteTool);
  registry.register(webFetchTool);
  registry.register(webSearchTool);
  registry.register(grepSearchTool);
  registry.register(memorySaveTool);
  registry.register(memoryLoadTool);
  registry.register(projectInfoTool);
  registry.register(gitStatusTool);
  registry.register(gitDiffTool);
  registry.register(gitLogTool);
  registry.register(gitCommitTool);
  registry.register(gitBranchTool);
  registry.register(selfReadTool);
  registry.register(selfListTool);
  registry.register(selfProposeTool);
  registry.register(selfApplyTool);
}
