import type { Transcript } from "../types";

/**
 * Speech-to-Text module using the Web Speech API.
 * Returns a promise that resolves when the user stops speaking.
 */

type STTOptions = {
  lang?: string;
  onInterim?: (text: string) => void;
};

export function createSpeechRecognition(options: STTOptions = {}) {
  const SpeechRecognition =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognition) {
    throw new Error(
      "SpeechRecognition API not supported in this browser. Use Chrome or Edge."
    );
  }

  const recognition = new SpeechRecognition();
  recognition.lang = options.lang ?? "en-US";
  recognition.interimResults = !!options.onInterim;
  recognition.continuous = false;

  return recognition;
}

export function listenForCommand(options: STTOptions = {}): Promise<Transcript> {
  return new Promise((resolve, reject) => {
    const recognition = createSpeechRecognition(options);

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const result = event.results[0];
      const transcript: Transcript = {
        text: result[0].transcript.trim(),
        confidence: result[0].confidence,
      };

      if (result.isFinal) {
        resolve(transcript);
      } else if (options.onInterim) {
        options.onInterim(result[0].transcript);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      reject(new Error(`Speech recognition error: ${event.error}`));
    };

    recognition.onend = () => {
      // If no result was returned, reject
    };

    recognition.start();
  });
}
