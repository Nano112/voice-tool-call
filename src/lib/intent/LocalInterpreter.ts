import type { IntentInput, ToolDefinition, AppContext } from "../types";
import type { IntentInterpreter } from "./types";

/**
 * Generic keyword-based interpreter driven by tool definitions.
 * Scores tools by keyword overlap. Falls back to chat.
 */
export function createLocalInterpreter(): IntentInterpreter {
  return async (input: IntentInput) => {
    const text = input.text.toLowerCase();

    const scored = input.tools
      .filter((t) => t.name !== "chat" && t.keywords?.length)
      .map((t) => {
        const matches = (t.keywords ?? []).filter((kw) => text.includes(kw.toLowerCase()));
        return { tool: t, score: matches.length };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score);

    if (scored.length > 0) {
      const best = scored[0].tool;
      const args = resolveArguments(best, text, input.context);
      return { tool: best.name, arguments: args };
    }

    // Fallback to chat if registered
    const hasChat = input.tools.some((t) => t.name === "chat");
    if (hasChat) {
      return {
        tool: "chat",
        arguments: {
          message: `I'm not sure how to handle that. I can: ${input.tools
            .filter((t) => t.name !== "chat")
            .map((t) => t.description.toLowerCase())
            .join(", ")}.`,
        },
      };
    }

    throw new Error(`Could not interpret command: "${input.text}"`);
  };
}

function resolveArguments(
  tool: ToolDefinition,
  text: string,
  context: AppContext
): Record<string, any> {
  const args: Record<string, any> = {};
  for (const [param, type] of Object.entries(tool.parameters)) {
    if (type === "boolean") {
      const stopWords = ["stop", "end", "pause", "off", "disable", "quit", "no", "false"];
      args[param] = !stopWords.some((w) => text.includes(w));
    } else if (type === "string") {
      const match = findContextMatch(text, context);
      if (match) args[param] = match;
    }
  }
  return args;
}

function findContextMatch(text: string, context: AppContext): string | null {
  for (const value of Object.values(context)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "object" && item !== null && "id" in item) {
          const nameMatch = item.name && text.includes(String(item.name).toLowerCase());
          const descMatch = item.description &&
            String(item.description).toLowerCase().split(/\s+/)
              .some((w: string) => w.length > 3 && text.includes(w));
          if (nameMatch || descMatch) return item.id;
        }
      }
    }
  }
  return null;
}
