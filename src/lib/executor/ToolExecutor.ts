import type { ToolCall, ToolExecutionResult } from "../types";

export type ToolHandler = (args: Record<string, any>) => any;

export class ToolExecutor {
  private registry = new Map<string, ToolHandler>();

  register(name: string, handler: ToolHandler): void {
    this.registry.set(name, handler);
  }

  has(name: string): boolean {
    return this.registry.has(name);
  }

  execute(call: ToolCall): ToolExecutionResult {
    const handler = this.registry.get(call.tool);
    if (!handler) {
      return { tool: call.tool, arguments: call.arguments, result: null, error: `Unknown tool: ${call.tool}` };
    }
    try {
      const result = handler(call.arguments);
      return { tool: call.tool, arguments: call.arguments, result };
    } catch (err) {
      return { tool: call.tool, arguments: call.arguments, result: null, error: err instanceof Error ? err.message : String(err) };
    }
  }

  executeAll(calls: ToolCall | ToolCall[]): ToolExecutionResult[] {
    const arr = Array.isArray(calls) ? calls : [calls];
    return arr.map((c) => this.execute(c));
  }
}
