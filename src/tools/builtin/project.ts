import { Tool, ToolResult } from "../types.js";
import * as fs from "fs/promises";
import * as path from "path";

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile(filePath: string): Promise<any | null> {
  try {
    const content = await fs.readFile(filePath, { encoding: "utf-8" });
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function readTextFile(filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, { encoding: "utf-8" });
  } catch {
    return null;
  }
}

async function getTopLevelDirs(rootDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(rootDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules")
      .map((e) => e.name);
  } catch {
    return [];
  }
}

export const projectInfoTool: Tool = {
  name: "project_info",
  description:
    "Detect project type, structure, and metadata. Reads package.json, tsconfig, Cargo.toml, pyproject.toml, go.mod, etc.",
  category: "project",
  builtin: true,
  parameters: [
    {
      name: "path",
      type: "string",
      description: "Project root directory (default: current dir)",
      required: false,
    },
  ],
  async execute(params): Promise<ToolResult> {
    try {
      const rootDir = path.resolve(params.path || ".");

      const checks = {
        packageJson: path.join(rootDir, "package.json"),
        tsconfig: path.join(rootDir, "tsconfig.json"),
        cargoToml: path.join(rootDir, "Cargo.toml"),
        pyprojectToml: path.join(rootDir, "pyproject.toml"),
        requirementsTxt: path.join(rootDir, "requirements.txt"),
        goMod: path.join(rootDir, "go.mod"),
        makefile: path.join(rootDir, "Makefile"),
        dockerCompose: path.join(rootDir, "docker-compose.yml"),
        dockerComposeYaml: path.join(rootDir, "docker-compose.yaml"),
        gitDir: path.join(rootDir, ".git"),
      };

      const [
        hasPackageJson,
        hasTsconfig,
        hasCargoToml,
        hasPyproject,
        hasRequirements,
        hasGoMod,
        hasMakefile,
        hasDockerCompose,
        hasDockerComposeYaml,
        hasGit,
      ] = await Promise.all(Object.values(checks).map((p) => fileExists(p)));

      const hasDocker = hasDockerCompose || hasDockerComposeYaml;

      // Detect project type and gather metadata
      let projectType: "node" | "python" | "rust" | "go" | "unknown" = "unknown";
      let name: string | undefined;
      let version: string | undefined;
      let dependenciesCount = 0;
      let scripts: string[] = [];

      if (hasPackageJson) {
        projectType = "node";
        const pkg = await readJsonFile(checks.packageJson);
        if (pkg) {
          name = pkg.name;
          version = pkg.version;
          const deps = {
            ...((pkg.dependencies as Record<string, string>) || {}),
            ...((pkg.devDependencies as Record<string, string>) || {}),
            ...((pkg.peerDependencies as Record<string, string>) || {}),
          };
          dependenciesCount = Object.keys(deps).length;
          scripts = Object.keys((pkg.scripts as Record<string, string>) || {});
        }
      } else if (hasCargoToml) {
        projectType = "rust";
        const content = await readTextFile(checks.cargoToml);
        if (content) {
          const nameMatch = content.match(/^\s*name\s*=\s*"([^"]+)"/m);
          const versionMatch = content.match(/^\s*version\s*=\s*"([^"]+)"/m);
          if (nameMatch) name = nameMatch[1];
          if (versionMatch) version = versionMatch[1];
          // Count deps under [dependencies] and [dev-dependencies] sections
          const depSections = content.match(/^\[(dev-)?dependencies\]([\s\S]*?)(?=^\[|$)/gm) || [];
          for (const section of depSections) {
            const lines = section.split("\n").slice(1); // skip the [dependencies] header
            for (const line of lines) {
              if (line.trim() && !line.trim().startsWith("#") && !line.trim().startsWith("[") && line.includes("=")) {
                dependenciesCount++;
              }
            }
          }
        }
      } else if (hasPyproject || hasRequirements) {
        projectType = "python";
        if (hasPyproject) {
          const content = await readTextFile(checks.pyprojectToml);
          if (content) {
            const nameMatch = content.match(/^\s*name\s*=\s*"([^"]+)"/m);
            const versionMatch = content.match(/^\s*version\s*=\s*"([^"]+)"/m);
            if (nameMatch) name = nameMatch[1];
            if (versionMatch) version = versionMatch[1];
          }
        }
        if (hasRequirements) {
          const content = await readTextFile(checks.requirementsTxt);
          if (content) {
            dependenciesCount = content
              .split("\n")
              .filter((line) => line.trim() && !line.trim().startsWith("#")).length;
          }
        }
      } else if (hasGoMod) {
        projectType = "go";
        const content = await readTextFile(checks.goMod);
        if (content) {
          const moduleMatch = content.match(/^module\s+(\S+)/m);
          if (moduleMatch) name = moduleMatch[1];
          const requireMatches = content.match(/^\s+\S+\s+v[\d.]+/gm);
          dependenciesCount = requireMatches ? requireMatches.length : 0;
        }
      }

      const topLevelDirs = await getTopLevelDirs(rootDir);

      const summary = {
        type: projectType,
        name,
        version,
        dependenciesCount,
        scripts,
        hasGit,
        hasDocker,
        hasTsconfig,
        hasMakefile,
        structure: topLevelDirs,
        rootDir,
        detectedFiles: {
          packageJson: hasPackageJson,
          tsconfig: hasTsconfig,
          cargoToml: hasCargoToml,
          pyprojectToml: hasPyproject,
          requirementsTxt: hasRequirements,
          goMod: hasGoMod,
          makefile: hasMakefile,
          dockerCompose: hasDocker,
          git: hasGit,
        },
      };

      return { success: true, data: summary };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  },
  tests: [
    {
      name: "detect SamaraCode as node project",
      input: { path: "." },
      validate: (r) =>
        r.success &&
        r.data !== undefined &&
        r.data.type === "node" &&
        typeof r.data.name === "string" &&
        r.data.hasGit === true,
    },
  ],
};
