// Lazy import to avoid bundling ONNX runtime in main chunk
type KokoroTTSType = import("kokoro-js").KokoroTTS;
const loadKokoroModule = () => import("kokoro-js");

export type KokoroTTSOptions = {
  dtype?: "fp32" | "fp16" | "q8" | "q4" | "q4f16";
  device?: "wasm" | "webgpu";
  voice?: string;
  onLoadProgress?: (progress: number) => void;
};

/**
 * High-quality TTS using Kokoro (82M parameters) running locally in-browser
 * via Transformers.js + ONNX.
 *
 * First call downloads the model (~50-80MB depending on dtype).
 * Subsequent calls use the cached model.
 */
export class KokoroTTSEngine {
  private model: KokoroTTSType | null = null;
  private loadingPromise: Promise<KokoroTTSType> | null = null;
  private options: KokoroTTSOptions;
  private audioContext: AudioContext | null = null;
  private currentSource: AudioBufferSourceNode | null = null;

  constructor(options: KokoroTTSOptions = {}) {
    // Auto-detect WebGPU support for faster inference
    const hasWebGPU = typeof navigator !== "undefined" && "gpu" in navigator;
    const autoDevice = hasWebGPU ? "webgpu" as const : "wasm" as const;
    // WebGPU needs fp32; WASM works best with q4 for speed
    const autoDtype = hasWebGPU ? "fp32" as const : "q4" as const;

    this.options = {
      dtype: options.dtype ?? autoDtype,
      device: options.device ?? autoDevice,
      voice: options.voice ?? "af_heart",
      onLoadProgress: options.onLoadProgress,
    };
  }

  async load(): Promise<void> {
    if (this.model) return;
    if (this.loadingPromise) {
      await this.loadingPromise;
      return;
    }

    this.loadingPromise = loadKokoroModule().then(({ KokoroTTS }) =>
      KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
        dtype: this.options.dtype,
        device: this.options.device,
      })
    );

    this.model = await this.loadingPromise;
    this.loadingPromise = null;
  }

  isLoaded(): boolean {
    return this.model !== null;
  }

  isLoading(): boolean {
    return this.loadingPromise !== null;
  }

  async listVoices(): Promise<string[]> {
    await this.load();
    return this.model!.list_voices() as unknown as string[];
  }

  setVoice(voice: string): void {
    this.options.voice = voice;
  }

  async speak(text: string): Promise<void> {
    await this.load();

    const audio = await this.model!.generate(text, {
      voice: this.options.voice as any,
    });

    // Play the generated audio via AudioContext
    await this.playAudioData(audio.audio, audio.sampling_rate);
  }

  private async playAudioData(
    audioData: Float32Array,
    sampleRate: number
  ): Promise<void> {
    if (!this.audioContext) {
      this.audioContext = new AudioContext({ sampleRate });
    }

    // Stop any currently playing audio
    this.stop();

    const buffer = this.audioContext.createBuffer(1, audioData.length, sampleRate);
    buffer.getChannelData(0).set(audioData);

    return new Promise((resolve) => {
      const source = this.audioContext!.createBufferSource();
      source.buffer = buffer;
      source.connect(this.audioContext!.destination);
      source.onended = () => {
        this.currentSource = null;
        resolve();
      };
      this.currentSource = source;
      source.start();
    });
  }

  stop(): void {
    if (this.currentSource) {
      try {
        this.currentSource.stop();
      } catch {
        // Already stopped
      }
      this.currentSource = null;
    }
  }
}
