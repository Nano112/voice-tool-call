import type { IntentInput, ToolCall } from "../types";
import type { IntentInterpreter } from "./types";

/**
 * Local LLM intent interpreter using node-llama-cpp.
 * Runs a small GGUF model with Metal/CUDA/Vulkan acceleration.
 * Optional peer dependency — only loaded when explicitly used.
 *
 * Supports: macOS (Metal), Linux/Windows (CUDA/Vulkan), CPU fallback.
 */

export type LlamaCppConfig = {
  /** Path to a local GGUF model file, or a HuggingFace model URI */
  model?: string;
  /** GPU layers to offload (-1 = all, 0 = CPU only) */
  gpuLayers?: number;
  /** Context size in tokens */
  contextSize?: number;
  /** Max conversation history entries to include */
  maxHistory?: number;
};

type HistoryEntry = {
  input: string;
  output: string;
  result?: string;
};

const DEFAULT_MODEL = "hf:bartowski/Qwen2.5-0.5B-Instruct-GGUF/Qwen2.5-0.5B-Instruct-Q4_K_M.gguf";

// Lazy import to avoid bundling in browser builds
const loadLlamaCpp = () => import("node-llama-cpp");

export type LlamaCppInterpreter = IntentInterpreter & {
  warmUp: () => Promise<void>;
  addToHistory: (input: string, output: ToolCall | ToolCall[], result?: string) => void;
  dispose: () => Promise<void>;
};

export function createLlamaCppInterpreter(config: LlamaCppConfig = {}): LlamaCppInterpreter {
  let llama: any = null;
  let model: any = null;
  let context: any = null;
  let session: any = null;
  let loadingPromise: Promise<void> | null = null;
  const history: HistoryEntry[] = [];
  const maxHistory = config.maxHistory ?? 10;

  async function initialize(): Promise<void> {
    if (session) return;
    if (loadingPromise) return loadingPromise;

    loadingPromise = (async () => {
      const { getLlama, resolveModelFile } = await loadLlamaCpp();

      llama = await getLlama();
      const modelPath = await resolveModelFile(config.model ?? DEFAULT_MODEL);

      model = await llama.loadModel({ modelPath });
      context = await model.createContext({
        contextSize: config.contextSize ?? 2048,
      });

      const { LlamaChatSession } = await loadLlamaCpp();
      session = new LlamaChatSession({
        contextSequence: context.getSequence(),
        systemPrompt: "You are a JSON function router. Output ONLY valid JSON. NEVER ask for clarification — always pick reasonable default values for missing parameters. Return a single {\"tool\":\"...\",\"arguments\":{...}} object or an array of them. NEVER output natural language.",
      });
    })();

    await loadingPromise;
    loadingPromise = null;
  }

  function buildPrompt(input: IntentInput): string {
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

    const examples = input.tools
      .flatMap((t) =>
        (t.examples ?? []).map(
          (ex) => `INPUT: "${ex.input}"\nOUTPUT: ${JSON.stringify({ tool: t.name, arguments: ex.arguments })}`
        )
      )
      .join("\n\n");

    let historyStr = "";
    if (history.length > 0) {
      historyStr = "\nRecent conversation:\n" + history.map((h) => {
        let entry = `USER: "${h.input}" → ${h.output}`;
        if (h.result) entry += ` → Result: "${h.result}"`;
        return entry;
      }).join("\n") + "\n";
    }

    return `Route this voice command to a JSON function call. ALWAYS call a tool with sensible defaults. Only use "chat" for greetings/jokes/questions unrelated to any tool.
State: ${contextStr}

Tools:
${toolSummary}

${examples}
${historyStr}
INPUT: "${input.text}"
OUTPUT:`;
  }

  const interpreter = async (input: IntentInput): Promise<ToolCall | ToolCall[]> => {
    await initialize();

    const prompt = buildPrompt(input);
    const response = await session.prompt(prompt, {
      maxTokens: 256,
      temperature: 0,
    });

    const parsed = tryParseToolCall(response);
    if (parsed) return parsed;

    // Fallback
    return { tool: "chat", arguments: { message: `I heard "${input.text}" but I'm not sure what to do with that.` } };
  };

  interpreter.warmUp = async () => { await initialize(); };

  interpreter.addToHistory = (input: string, output: ToolCall | ToolCall[], result?: string) => {
    history.push({ input, output: JSON.stringify(output), result });
    while (history.length > maxHistory) history.shift();
  };

  interpreter.dispose = async () => {
    if (context) await context.dispose();
    if (model) await model.dispose();
    if (llama) await llama.dispose();
    session = null;
    context = null;
    model = null;
    llama = null;
  };

  return interpreter;
}

function tryParseToolCall(response: string): ToolCall | ToolCall[] | null {
  let cleaned = response.trim().replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();

  const arrayMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrayMatch) {
    try {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) {
        const valid = parsed.filter((c: any) => c.tool != null);
        if (valid.length > 0) return valid as ToolCall[];
      }
    } catch { /* fall through */ }
  }

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
