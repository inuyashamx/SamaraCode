// === Tool System Types ===

export interface ToolParameter {
  name: string;
  type: "string" | "number" | "boolean" | "object" | "array";
  description: string;
  required: boolean;
  default?: any;
}

export interface ToolTest {
  name: string;
  input: Record<string, any>;
  validate: (result: ToolResult) => boolean;
}

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
}

export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameter[];
  execute: (params: Record<string, any>) => Promise<ToolResult>;
  tests?: ToolTest[];
  // Metadata
  builtin: boolean;
  category: string;
  createdAt?: Date;
}

// For LLM function calling format
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, any>;
    required: string[];
  };
}

export function toolToDefinition(tool: Tool): ToolDefinition {
  const properties: Record<string, any> = {};
  const required: string[] = [];

  for (const param of tool.parameters) {
    const prop: Record<string, any> = {
      type: param.type,
      description: param.description,
    };
    // Gemini requires "items" on array types
    if (param.type === "array") {
      prop.items = { type: "string" };
    }
    properties[param.name] = prop;
    if (param.required) required.push(param.name);
  }

  return {
    name: tool.name,
    description: tool.description,
    parameters: { type: "object", properties, required },
  };
}
