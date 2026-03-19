import type { IntentInput, ToolCall } from "../types";
import type { IntentInterpreter } from "./types";

interface LanguageModelSession {
  prompt(text: string): Promise<string>;
  destroy(): void;
}

interface LanguageModelAPI {
  availability(): Promise<string>;
  create(options: { systemPrompt: string; expectedOutputLanguages?: string[] }): Promise<LanguageModelSession>;
}

declare global {
  interface Window {
    LanguageModel?: LanguageModelAPI;
  }
}

export async function isLanguageModelAvailable(): Promise<boolean> {
  if (!window.LanguageModel) return false;
  try {
    const availability = await window.LanguageModel.availability();
    return availability === "available" || availability === "downloadable";
  } catch {
    return false;
  }
}

type HistoryEntry = {
  input: string;
  output: string; // the JSON tool call that was executed
  result?: string; // the tool result if it was a string
};

const MAX_HISTORY = 10;

function buildFewShotPrompt(input: IntentInput, history: HistoryEntry[]): string {
  const contextStr = Object.entries(input.context)
    .map(([key, value]) => {
      if (Array.isArray(value)) {
        const items = value.map((v: any) =>
          typeof v === "object" && v.id
            ? `${v.id}="${v.name}"${v.description ? `(${v.description})` : ""}`
            : JSON.stringify(v)
        );
        return `${key}: ${items.join(", ")}`;
      }
      return `${key}: ${JSON.stringify(value)}`;
    })
    .join(". ");

  const toolSummary = input.tools.map((t) => {
    const params = Object.entries(t.parameters).map(([k, v]) => `${k}:${v}`).join(", ");
    return `${t.name}(${params}): ${t.description}`;
  }).join("\n");

  // Single-tool examples from definitions
  const singleExamples = input.tools
    .flatMap((t) =>
      (t.examples ?? []).map(
        (ex) => `INPUT: "${ex.input}"\nOUTPUT: ${JSON.stringify({ tool: t.name, arguments: ex.arguments })}`
      )
    )
    .join("\n\n");

  // Multi-tool examples
  const multiExamples = `INPUT: "make the background blue and play a beep"
OUTPUT: [{"tool":"setBackgroundColor","arguments":{"color":"#2563eb"}},{"tool":"playSound","arguments":{"frequency":440,"duration":300}}]

INPUT: "make it pink and play a sound"
OUTPUT: [{"tool":"setBackgroundColor","arguments":{"color":"#ec4899"}},{"tool":"playSound","arguments":{"frequency":440,"duration":300}}]`;

  // Default-filling examples — NEVER ask for clarification, just pick reasonable defaults
  const defaultExamples = `INPUT: "play a sound"
OUTPUT: {"tool":"playSound","arguments":{"frequency":440,"duration":300}}

INPUT: "play a chime"
OUTPUT: {"tool":"playSound","arguments":{"frequency":660,"duration":200}}

INPUT: "change the color"
OUTPUT: {"tool":"setBackgroundColor","arguments":{"color":"#3b82f6"}}`;

  // Correction example
  const correctionExample = `INPUT: "play a tone at 440 hertz for 500 milliseconds"
OUTPUT: {"tool":"playSound","arguments":{"frequency":440,"duration":500}}

INPUT: "I said 500 seconds not milliseconds"
OUTPUT: {"tool":"playSound","arguments":{"frequency":440,"duration":500000}}`;

  // Build conversation history context
  let historyStr = "";
  if (history.length > 0) {
    historyStr = "\nRecent conversation:\n" + history.map((h) => {
      let entry = `USER: "${h.input}" → ${h.output}`;
      if (h.result) entry += ` → Result: "${h.result}"`;
      return entry;
    }).join("\n") + "\n";
  }

  return `You route voice commands to JSON function calls. RULES:
1. ALWAYS call a tool. NEVER ask for clarification — use sensible defaults for missing parameters.
2. For multiple actions, return a JSON array.
3. If the user corrects a previous command, re-execute with corrected parameters.
4. Only use "chat" for greetings, jokes, math, or questions completely unrelated to any tool.

State: ${contextStr}

Tools:
${toolSummary}

${singleExamples}

${defaultExamples}

${multiExamples}

${correctionExample}
${historyStr}
INPUT: "${input.text}"
OUTPUT:`;
}

export type LanguageModelInterpreter = IntentInterpreter & {
  warmUp: () => Promise<void>;
  addToHistory: (input: string, output: ToolCall | ToolCall[], result?: string) => void;
};

export function createLanguageModelInterpreter(): LanguageModelInterpreter {
  let session: LanguageModelSession | null = null;
  let sessionPromise: Promise<LanguageModelSession> | null = null;
  const history: HistoryEntry[] = [];

  async function getSession(): Promise<LanguageModelSession> {
    if (session) return session;
    if (sessionPromise) return sessionPromise;
    if (!window.LanguageModel) throw new Error("LanguageModel API not available.");

    sessionPromise = window.LanguageModel.create({
      systemPrompt: "You are a JSON function router. Output ONLY valid JSON. NEVER ask for clarification or more information — always pick reasonable default values for missing parameters. Return a single {tool,arguments} object or an array of them. NEVER output natural language.",
      expectedOutputLanguages: ["en"],
    });
    session = await sessionPromise;
    sessionPromise = null;
    return session;
  }

  const interpreter = async (input: IntentInput): Promise<ToolCall | ToolCall[]> => {
    const sess = await getSession();
    const prompt = buildFewShotPrompt(input, history);

    let response = await sess.prompt(prompt);
    let parsed = tryParseToolCall(response);
    if (parsed) return parsed;

    // Retry with stricter nudge
    const toolNames = input.tools.map((t) => t.name).join(", ");
    response = await sess.prompt(
      `Route this voice command to JSON. Tools: ${toolNames}.\nFor multiple actions, return an array: [{"tool":"...","arguments":{...}}, ...]\nCommand: "${input.text}"\nJSON:`
    );
    parsed = tryParseToolCall(response);
    if (parsed) return parsed;

    return { tool: "chat", arguments: { message: `I heard "${input.text}" but I'm not sure what to do with that.` } };
  };

  interpreter.warmUp = async () => { await getSession(); };

  interpreter.addToHistory = (input: string, output: ToolCall | ToolCall[], result?: string) => {
    history.push({
      input,
      output: JSON.stringify(output),
      result,
    });
    // Keep history bounded
    while (history.length > MAX_HISTORY) history.shift();
  };

  return interpreter;
}

function tryParseToolCall(response: string): ToolCall | ToolCall[] | null {
  let cleaned = response.trim().replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

  // Try to extract a JSON array first
  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) {
        const valid = parsed.filter((c: any) => c.tool != null);
        if (valid.length > 0) return valid as ToolCall[];
      }
    } catch {
      // Fall through to single object extraction
    }
  }

  // Try single object
  const jsonMatch = cleaned.match(/\{[^{}]*"tool"\s*:\s*"[^"]+?"[^{}]*\}/);
  if (jsonMatch) cleaned = jsonMatch[0];

  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) {
      const valid = parsed.filter((c: any) => c.tool != null);
      return valid.length > 0 ? (valid as ToolCall[]) : null;
    }
    const tool = parsed.tool ?? parsed.function;
    if (!tool) return null;
    return { tool, arguments: parsed.arguments ?? parsed.args ?? {} } as ToolCall;
  } catch {
    return null;
  }
}
