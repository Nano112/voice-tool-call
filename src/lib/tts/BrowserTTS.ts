export type TTSOptions = {
  lang?: string;
  rate?: number;
  pitch?: number;
  voice?: string;
};

/**
 * Text-to-Speech module using the Web Speech Synthesis API.
 * Fully local, zero latency startup. Used as fast fallback.
 */
export class BrowserTTS {
  private options: Required<Omit<TTSOptions, "voice">> & { voice?: string };

  constructor(options: TTSOptions = {}) {
    this.options = {
      lang: options.lang ?? "en-US",
      rate: options.rate ?? 1.0,
      pitch: options.pitch ?? 1.0,
      voice: options.voice,
    };
  }

  speak(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof window === "undefined" || !window.speechSynthesis) {
        resolve(); // Silently skip in Node
        return;
      }

      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = this.options.lang;
      utterance.rate = this.options.rate;
      utterance.pitch = this.options.pitch;

      if (this.options.voice) {
        const voices = window.speechSynthesis.getVoices();
        const match = voices.find(
          (v) =>
            v.name.toLowerCase().includes(this.options.voice!.toLowerCase()) ||
            v.voiceURI.toLowerCase().includes(this.options.voice!.toLowerCase())
        );
        if (match) utterance.voice = match;
      }

      utterance.onend = () => resolve();
      utterance.onerror = (e) => reject(new Error(`TTS error: ${e.error}`));

      window.speechSynthesis.speak(utterance);
    });
  }

  stop() {
    if (typeof window !== "undefined") {
      window.speechSynthesis?.cancel();
    }
  }
}
