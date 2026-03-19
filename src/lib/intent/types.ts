import type { IntentInput, ToolCall } from "../types";

export type IntentInterpreter = (input: IntentInput) => Promise<ToolCall | ToolCall[]>;

export function parseToolCallResponse(content: string): ToolCall | ToolCall[] {
  const cleaned = content
    .replace(/```json\n?/g, "")
    .replace(/```\n?/g, "")
    .trim();
  const parsed = JSON.parse(cleaned);
  return Array.isArray(parsed) ? (parsed as ToolCall[]) : (parsed as ToolCall);
}
