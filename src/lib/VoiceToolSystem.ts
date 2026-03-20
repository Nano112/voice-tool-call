import { TypedEventEmitter } from "./EventEmitter";
import type {
  AppContext, Capabilities, IntentMode, RegisterToolOptions,
  ToolCall, ToolDefinition, ToolExecutionResult, TTSMode, TTSStatus,
  Transcript, WakeWordState,
} from "./types";
import { WakeWordListener } from "./stt/WakeWordListener";
import { listenForCommand } from "./stt/SpeechRecognition";
import { createLocalInterpreter } from "./intent/LocalInterpreter";
import { createApiInterpreter } from "./intent/ApiInterpreter";
import { createLanguageModelInterpreter } from "./intent/LanguageModelInterpreter";
import type { IntentInterpreter } from "./intent/types";
import { TTSManager } from "./tts/TTSManager";
import { ToolExecutor } from "./executor/ToolExecutor";
import { detectCapabilities } from "./detect";

export type VoiceToolEventMap = {
  "wakeword": { state: WakeWordState };
  "transcript": Transcript;
  "intent": ToolCall | ToolCall[];
  "executed": ToolExecutionResult[];
  "response": { text: string };
  "tts:status": { status: TTSStatus };
  "tts:mode": { mode: TTSMode };
  "intent:mode": { mode: IntentMode };
  "loading": { module: string; status: "loading" | "ready" | "error" };
  "scene": { scene: string };
  "error": { error: string; source?: string };
  "state": { running: boolean };
  "ready": { capabilities: Capabilities };
};

export type SceneDefinition = {
  tools: Record<string, RegisterToolOptions>;
  context?: AppContext;
  /** Called when entering this scene */
  onEnter?: () => void;
  /** Called when leaving this scene */
  onExit?: () => void;
};

export type VoiceToolConfig = {
  wakeWords?: string[];
  tts?: TTSMode;
  intent?: IntentMode;
  lang?: string;
  apiUrl?: string;
  apiKey?: string;
  kokoro?: { dtype?: string; device?: string; voice?: string };
  llamaCpp?: { model?: string; gpuLayers?: number; contextSize?: number };
  autoDetect?: boolean;
  autoSpeak?: boolean;
  commandTimeout?: number;
};

export class VoiceToolSystem extends TypedEventEmitter<VoiceToolEventMap> {
  private config: Required<
    Pick<VoiceToolConfig, "lang" | "autoDetect" | "autoSpeak" | "commandTimeout">
  > & VoiceToolConfig;

  private context: AppContext = {};
  private toolDefs: ToolDefinition[] = [];
  private globalToolNames = new Set<string>(); // Tools that persist across scenes
  private scenes = new Map<string, SceneDefinition>();
  private currentScene: string | null = null;
  private executor = new ToolExecutor();
  private ttsManager: TTSManager;
  private wakeWordListener: WakeWordListener | null = null;
  private interpreter: IntentInterpreter;
  private lmInterpreter: IntentInterpreter | null = null;
  private llamaCppInterpreter: any | null = null; // LlamaCppInterpreter type
  private localInterpreter: IntentInterpreter;
  private apiInterpreter: IntentInterpreter | null = null;
  private intentMode: IntentMode;
  private running = false;

  constructor(config: VoiceToolConfig = {}) {
    super();
    this.config = {
      lang: "en-US",
      autoDetect: true,
      autoSpeak: true,
      commandTimeout: 10000,
      ...config,
    };

    this.intentMode = config.intent ?? "local";
    this.localInterpreter = createLocalInterpreter();
    this.interpreter = this.localInterpreter;

    if (config.intent === "api" && config.apiUrl && config.apiKey) {
      this.apiInterpreter = createApiInterpreter(config.apiUrl, config.apiKey);
      this.interpreter = this.apiInterpreter;
    }

    this.ttsManager = new TTSManager({
      mode: config.tts,
      kokoro: config.kokoro as any,
      onModeChange: (mode) => this.emit("tts:mode", { mode }),
      onStatusChange: (status) => this.emit("tts:status", { status }),
    });
  }

  // --- Tool Registration ---

  registerTool(name: string, options: RegisterToolOptions): void {
    // Remove existing definition if re-registering
    this.toolDefs = this.toolDefs.filter((t) => t.name !== name);

    this.toolDefs.push({
      name,
      description: options.description,
      parameters: options.parameters,
      keywords: options.keywords,
      examples: options.examples,
    });

    this.executor.register(name, options.handler);
  }

  registerTools(tools: Record<string, RegisterToolOptions>): void {
    for (const [name, opts] of Object.entries(tools)) {
      this.registerTool(name, opts);
    }
  }

  getToolDefinitions(): ToolDefinition[] {
    return [...this.toolDefs];
  }

  /**
   * Remove a tool by name.
   */
  unregisterTool(name: string): void {
    this.toolDefs = this.toolDefs.filter((t) => t.name !== name);
    this.globalToolNames.delete(name);
  }

  /**
   * Remove all tools, or only non-global ones.
   */
  clearTools(options?: { keepGlobal?: boolean }): void {
    if (options?.keepGlobal) {
      this.toolDefs = this.toolDefs.filter((t) => this.globalToolNames.has(t.name));
    } else {
      this.toolDefs = [];
      this.globalToolNames.clear();
    }
  }

  /**
   * Mark a tool as global — it persists across scene changes.
   * Call after registerTool.
   */
  setGlobal(name: string): void {
    this.globalToolNames.add(name);
  }

  /**
   * Register a tool that persists across all scenes.
   */
  registerGlobalTool(name: string, options: RegisterToolOptions): void {
    this.registerTool(name, options);
    this.globalToolNames.add(name);
  }

  // --- Scenes ---

  /**
   * Define a named scene with its own tools and context.
   */
  defineScene(name: string, scene: SceneDefinition): void {
    this.scenes.set(name, scene);
  }

  /**
   * Switch to a scene. Replaces non-global tools and merges context.
   */
  setScene(name: string): void {
    const scene = this.scenes.get(name);
    if (!scene) throw new Error("Unknown scene: " + name);

    // Exit current scene
    if (this.currentScene) {
      this.scenes.get(this.currentScene)?.onExit?.();
    }

    // Remove non-global tools
    this.clearTools({ keepGlobal: true });

    // Register scene tools
    this.registerTools(scene.tools);

    // Merge scene context
    if (scene.context) {
      this.context = { ...this.context, ...scene.context };
    }

    this.currentScene = name;
    this.emit("scene", { scene: name });

    scene.onEnter?.();
  }

  /**
   * Get the current scene name.
   */
  getScene(): string | null {
    return this.currentScene;
  }

  /**
   * Get all defined scene names.
   */
  getScenes(): string[] {
    return Array.from(this.scenes.keys());
  }

  // --- Context ---

  setContext(context: AppContext): void {
    this.context = context;
  }

  updateContext(partial: Partial<AppContext>): void {
    this.context = { ...this.context, ...partial };
  }

  getContext(): AppContext {
    return { ...this.context };
  }

  // --- Lifecycle ---

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.emit("state", { running: true });

    const isBrowser = typeof window !== "undefined";

    // Start wake word listener IMMEDIATELY (browser only)
    if (isBrowser) {
      this.startWakeWord();
    }

    // Load models in the background
    const caps = this.config.autoDetect
      ? (isBrowser ? await detectCapabilities() : { speechRecognition: false, languageModel: false, webGPU: false, speechSynthesis: false })
      : { speechRecognition: false, languageModel: false, webGPU: false, speechSynthesis: false };
    this.emit("ready", { capabilities: caps });

    {
      const tasks: Promise<void>[] = [];

      // Intent: pick the best available LLM
      if (this.config.intent === "llama-cpp" || (!isBrowser && this.config.intent !== "api")) {
        // Node/Bun: use node-llama-cpp with Metal/CUDA
        tasks.push(this.loadLlamaCpp());
      } else if (isBrowser && caps.languageModel && this.config.intent !== "api") {
        // Browser: use Chrome LanguageModel (Gemini Nano)
        tasks.push(
          (async () => {
            try {
              this.emit("loading", { module: "language-model", status: "loading" });
              const lm = createLanguageModelInterpreter();
              await lm.warmUp();
              this.lmInterpreter = lm;
              this.interpreter = lm;
              this.intentMode = "language-model";
              this.emit("intent:mode", { mode: "language-model" });
              this.emit("loading", { module: "language-model", status: "ready" });
            } catch {
              this.emit("loading", { module: "language-model", status: "error" });
            }
          })()
        );
      }

      // TTS: Kokoro works in both browser and Node
      if (this.config.tts === "kokoro") {
        tasks.push(
          (async () => {
            try {
              this.emit("loading", { module: "kokoro", status: "loading" });
              await this.ttsManager.preloadKokoro();
              this.emit("loading", { module: "kokoro", status: "ready" });
            } catch {
              this.emit("loading", { module: "kokoro", status: "error" });
            }
          })()
        );
      }

      await Promise.all(tasks);
    }
  }

  stop(): void {
    this.running = false;
    this.wakeWordListener?.stop();
    this.wakeWordListener = null;
    this.ttsManager.stop();
    this.emit("state", { running: false });
  }

  isRunning(): boolean {
    return this.running;
  }

  async destroy(): Promise<void> {
    this.stop();
    if (this.llamaCppInterpreter?.dispose) {
      await this.llamaCppInterpreter.dispose();
    }
    this.removeAllListeners();
  }

  // --- Manual Triggers ---

  async pushToTalk(): Promise<ToolExecutionResult[]> {
    const wasListening = !!this.wakeWordListener;
    if (wasListening) {
      this.wakeWordListener?.stop();
      this.wakeWordListener = null;
    }

    try {
      const transcript = await listenForCommand({ lang: this.config.lang });
      this.emit("transcript", transcript);
      return this.processIntent(transcript.text);
    } finally {
      if (wasListening && this.running) {
        this.startWakeWord();
      }
    }
  }

  async processText(text: string): Promise<ToolExecutionResult[]> {
    this.emit("transcript", { text, confidence: 1 });
    return this.processIntent(text);
  }

  // --- TTS ---

  async speak(text: string): Promise<void> {
    return this.ttsManager.speak(text);
  }

  stopSpeaking(): void {
    this.ttsManager.stop();
  }

  async preloadKokoro(): Promise<void> {
    return this.ttsManager.preloadKokoro();
  }

  // --- Configuration ---

  setIntentMode(mode: IntentMode): void {
    this.intentMode = mode;
    switch (mode) {
      case "language-model":
        if (this.lmInterpreter) this.interpreter = this.lmInterpreter;
        break;
      case "llama-cpp":
        if (this.llamaCppInterpreter) this.interpreter = this.llamaCppInterpreter;
        break;
      case "api":
        if (this.apiInterpreter) this.interpreter = this.apiInterpreter;
        break;
      default:
        this.interpreter = this.localInterpreter;
    }
    this.emit("intent:mode", { mode });
  }

  getIntentMode(): IntentMode {
    return this.intentMode;
  }

  setTTSMode(mode: TTSMode): void {
    this.ttsManager.setMode(mode);
  }

  getTTSMode(): TTSMode {
    return this.ttsManager.getMode();
  }

  async getCapabilities(): Promise<Capabilities> {
    return detectCapabilities();
  }

  // --- Internal ---

  private async loadLlamaCpp(): Promise<void> {
    try {
      this.emit("loading", { module: "llama-cpp", status: "loading" });
      const { createLlamaCppInterpreter } = await import("./intent/LlamaCppInterpreter");
      const llm = createLlamaCppInterpreter(this.config.llamaCpp);
      await llm.warmUp();
      this.llamaCppInterpreter = llm;
      this.interpreter = llm;
      this.intentMode = "llama-cpp";
      this.emit("intent:mode", { mode: "llama-cpp" });
      this.emit("loading", { module: "llama-cpp", status: "ready" });
    } catch (err) {
      this.emit("loading", { module: "llama-cpp", status: "error" });
      this.emit("error", {
        error: `Failed to load llama-cpp: ${err instanceof Error ? err.message : String(err)}`,
        source: "llama-cpp",
      });
    }
  }

  private startWakeWord(): void {
    if (this.wakeWordListener) return;

    const wakeWords = this.config.wakeWords ?? [
      "hey assistant", "hey computer",
    ];

    this.wakeWordListener = new WakeWordListener({
      wakeWords,
      lang: this.config.lang,
      commandTimeout: this.config.commandTimeout,
      onWakeWord: () => {},
      onCommand: (transcript) => {
        this.emit("transcript", transcript);
        this.processIntent(transcript.text).catch((err) => {
          this.emit("error", { error: err instanceof Error ? err.message : String(err), source: "pipeline" });
        });
      },
      onStateChange: (state) => {
        this.emit("wakeword", { state });
      },
      onError: (error) => {
        this.emit("error", { error, source: "stt" });
      },
    });

    this.wakeWordListener.start();
  }

  private async processIntent(text: string): Promise<ToolExecutionResult[]> {
    try {
      const toolCalls = await this.interpreter({
        text,
        tools: this.toolDefs,
        context: this.context,
      });

      this.emit("intent", toolCalls);

      const results = this.executor.executeAll(toolCalls);
      this.emit("executed", results);

      // Extract speakable text from results (supports string or { message } objects)
      const getSpeakable = (result: any): string => {
        if (typeof result === "string") return result;
        if (result && typeof result === "object" && typeof result.message === "string") return result.message;
        return "";
      };

      // Feed history to LM/llama interpreter for conversation memory
      const resultStr = results.map((r) => getSpeakable(r.result)).filter(Boolean).join("; ");
      const activeInterpreter = this.lmInterpreter ?? this.llamaCppInterpreter;
      if (activeInterpreter && "addToHistory" in activeInterpreter) {
        activeInterpreter.addToHistory(text, toolCalls, resultStr || undefined);
      }

      // Auto-speak results
      if (this.config.autoSpeak) {
        for (const r of results) {
          const speakable = getSpeakable(r.result);
          if (speakable) {
            this.emit("response", { text: speakable });
            await this.ttsManager.speak(speakable);
          }
        }
      }

      return results;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.emit("error", { error, source: "intent" });

      if (this.config.autoSpeak) {
        const spoken = "Sorry, I didn't understand that command.";
        await this.ttsManager.speak(spoken);
      }

      throw err;
    }
  }
}
