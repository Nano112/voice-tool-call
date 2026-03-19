import type { Transcript } from "../types";

export type WakeWordState = "idle" | "listening" | "activated" | "processing";

export type WakeWordOptions = {
  /** Wake phrases to listen for (case-insensitive) */
  wakeWords: string[];
  /** Called when wake word is detected */
  onWakeWord?: () => void;
  /** Called with the command transcript after wake word */
  onCommand: (transcript: Transcript) => void;
  /** Called when state changes */
  onStateChange?: (state: WakeWordState) => void;
  /** Called on error */
  onError?: (error: string) => void;
  /** Language for recognition */
  lang?: string;
  /** Max silence (ms) after wake word before giving up on command */
  commandTimeout?: number;
  /** Debounce (ms) after wake word detection — ignores trailing audio */
  activationDebounce?: number;
  /** Minimum command length (characters) to accept */
  minCommandLength?: number;
};

/**
 * Continuous wake word listener.
 * Runs the Web Speech API in continuous mode, scanning for the wake phrase.
 * Once detected, captures the remainder (or next utterance) as the command.
 */
export class WakeWordListener {
  private recognition: SpeechRecognition | null = null;
  private state: WakeWordState = "idle";
  private options: Required<WakeWordOptions>;
  private commandTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  /** Timestamp when wake word was detected — used for debounce */
  private activatedAt = 0;

  constructor(options: WakeWordOptions) {
    this.options = {
      lang: "en-US",
      commandTimeout: 10000,
      activationDebounce: 1000,
      minCommandLength: 2,
      onWakeWord: () => {},
      onStateChange: () => {},
      onError: () => {},
      ...options,
    };
  }

  private setState(state: WakeWordState) {
    if (this.state === state) return; // Prevent duplicate emissions
    this.state = state;
    this.options.onStateChange(state);
  }

  private normalizeText(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  private matchesWakeWord(text: string): { matched: boolean; remainder: string } {
    const normalized = this.normalizeText(text);

    for (const wake of this.options.wakeWords) {
      const normalizedWake = this.normalizeText(wake);
      const idx = normalized.indexOf(normalizedWake);
      if (idx !== -1) {
        const remainder = normalized.slice(idx + normalizedWake.length).trim();
        return { matched: true, remainder };
      }
    }

    return { matched: false, remainder: "" };
  }

  /** Check if we're still in the debounce window after activation */
  private isInDebounce(): boolean {
    return Date.now() - this.activatedAt < this.options.activationDebounce;
  }

  /** Check if a command is long enough to be real speech (not noise) */
  private isValidCommand(text: string): boolean {
    return text.trim().length >= this.options.minCommandLength;
  }

  start() {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      this.options.onError("SpeechRecognition not supported in this browser");
      return;
    }

    this.stopped = false;
    const recognition = new SpeechRecognition();
    recognition.lang = this.options.lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    this.recognition = recognition;

    // Only reset to listening if we're not already activated (e.g. after auto-restart)
    if (this.state !== "activated") {
      this.setState("listening");
    }

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript;

        if (this.state === "listening") {
          // Scanning for wake word
          const { matched, remainder } = this.matchesWakeWord(text);

          if (matched) {
            this.activatedAt = Date.now();
            this.options.onWakeWord();

            if (remainder && this.isValidCommand(remainder) && result.isFinal) {
              // Wake word + command in same utterance: "Hey Olsen switch to desk"
              this.setState("activated");
              this.options.onCommand({
                text: remainder,
                confidence: result[0].confidence,
              });
              // Small delay before going back to listening to avoid UI flash
              setTimeout(() => {
                if (this.state !== "idle") this.setState("listening");
              }, 300);
              this.clearCommandTimer();
            } else {
              // Wait for the actual command
              this.setState("activated");
              this.startCommandTimer();
            }
          }
        } else if (this.state === "activated") {
          // Still in debounce window — ignore trailing noise from wake word
          if (this.isInDebounce()) {
            // Only accept if it's clearly a new, substantial utterance
            const { remainder } = this.matchesWakeWord(text);
            const candidate = remainder || text.trim();
            if (!result.isFinal || !this.isValidCommand(candidate)) {
              this.startCommandTimer();
              continue;
            }
          }

          this.clearCommandTimer();

          if (result.isFinal) {
            const { matched, remainder } = this.matchesWakeWord(text);
            const command = matched ? remainder : text.trim();

            if (this.isValidCommand(command)) {
              this.options.onCommand({
                text: command,
                confidence: result[0].confidence,
              });
              // Small delay before going back to listening to avoid UI flash
              setTimeout(() => {
                if (this.state !== "idle") this.setState("listening");
              }, 300);
            } else {
              // Too short or just wake word — keep waiting
              this.startCommandTimer();
            }
          } else {
            // Interim result, keep waiting
            this.startCommandTimer();
          }
        }
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === "no-speech" || event.error === "aborted") {
        return;
      }
      this.options.onError(event.error);
    };

    recognition.onend = () => {
      // Auto-restart with a fresh instance unless explicitly stopped.
      // Reusing the same instance after onend is unreliable in Chrome.
      if (!this.stopped) {
        setTimeout(() => {
          if (!this.stopped) {
            this.recognition = null;
            this.start(); // Creates a fresh recognition instance
          }
        }, 100);
      } else {
        this.setState("idle");
      }
    };

    recognition.start();
  }

  stop() {
    this.stopped = true;
    this.clearCommandTimer();
    this.recognition?.stop();
    this.recognition = null;
    this.setState("idle");
  }

  getState(): WakeWordState {
    return this.state;
  }

  private startCommandTimer() {
    this.clearCommandTimer();
    this.commandTimer = setTimeout(() => {
      this.setState("listening");
    }, this.options.commandTimeout);
  }

  private clearCommandTimer() {
    if (this.commandTimer) {
      clearTimeout(this.commandTimer);
      this.commandTimer = null;
    }
  }
}
