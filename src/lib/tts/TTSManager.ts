import { BrowserTTS } from "./BrowserTTS";

export type TTSMode = "browser" | "kokoro";

export type TTSStatus = "generating" | "speaking" | "done";

export type TTSManagerOptions = {
  mode?: TTSMode;
  kokoro?: Record<string, any>;
  onModeChange?: (mode: TTSMode) => void;
  onLoadingChange?: (loading: boolean) => void;
  onStatusChange?: (status: TTSStatus) => void;
};

/**
 * Unified TTS manager.
 * Falls back to browser TTS while Kokoro loads, then switches automatically.
 * KokoroTTS is lazy-loaded to avoid pulling kokoro-js into browser bundles.
 */
export class TTSManager {
  private browserTTS: BrowserTTS;
  private kokoroTTS: any | null = null; // Lazy-loaded KokoroTTSEngine
  private kokoroOpts: Record<string, any> | undefined;
  private mode: TTSMode;
  private options: TTSManagerOptions;

  constructor(options: TTSManagerOptions = {}) {
    this.options = options;
    this.mode = options.mode ?? "browser";
    this.browserTTS = new BrowserTTS({ rate: 1.05 });
    this.kokoroOpts = options.kokoro;
  }

  getMode(): TTSMode {
    return this.mode;
  }

  isKokoroLoaded(): boolean {
    return this.kokoroTTS?.isLoaded() ?? false;
  }

  isKokoroLoading(): boolean {
    return this.kokoroTTS?.isLoading() ?? false;
  }

  /**
   * Lazy-load and initialize KokoroTTSEngine.
   */
  async preloadKokoro(): Promise<void> {
    this.options.onLoadingChange?.(true);
    try {
      if (!this.kokoroTTS) {
        const { KokoroTTSEngine } = await import("./KokoroTTS");
        this.kokoroTTS = new KokoroTTSEngine(this.kokoroOpts);
      }
      await this.kokoroTTS.load();
      this.mode = "kokoro";
      this.options.onModeChange?.("kokoro");
    } finally {
      this.options.onLoadingChange?.(false);
    }
  }

  setMode(mode: TTSMode): void {
    this.mode = mode;
    this.options.onModeChange?.(mode);
  }

  setKokoroVoice(voice: string): void {
    this.kokoroTTS?.setVoice(voice);
  }

  async listKokoroVoices(): Promise<string[]> {
    return this.kokoroTTS?.listVoices() ?? [];
  }

  async speak(text: string): Promise<void> {
    const useKokoro = this.mode === "kokoro" && this.kokoroTTS?.isLoaded();

    if (useKokoro) {
      this.options.onStatusChange?.("generating");
    }

    try {
      this.options.onStatusChange?.("speaking");
      if (useKokoro) {
        await this.kokoroTTS.speak(text);
      } else {
        await this.browserTTS.speak(text);
      }
    } finally {
      this.options.onStatusChange?.("done");
    }
  }

  stop(): void {
    this.browserTTS.stop();
    this.kokoroTTS?.stop();
  }
}
