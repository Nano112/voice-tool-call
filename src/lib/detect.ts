export type FeatureStatus = "available" | "downloadable" | "unavailable" | "needs-flags" | "unsupported-browser";

export type DetailedCapabilities = {
  speechRecognition: { status: FeatureStatus; instructions?: string };
  languageModel: { status: FeatureStatus; instructions?: string };
  webGPU: { status: FeatureStatus; instructions?: string };
  speechSynthesis: { status: FeatureStatus };
  microphone: { status: FeatureStatus | "prompt" | "denied" | "granted" };
};

// Simple boolean capabilities for backward compat
export type Capabilities = {
  speechRecognition: boolean;
  languageModel: boolean;
  webGPU: boolean;
  speechSynthesis: boolean;
};

export function hasSpeechRecognition(): boolean {
  return typeof window !== "undefined" &&
    !!(window.SpeechRecognition || (window as any).webkitSpeechRecognition);
}

export async function getLanguageModelStatus(): Promise<{ status: FeatureStatus; raw?: string }> {
  if (typeof window === "undefined") return { status: "unsupported-browser" };

  const lm = (window as any).LanguageModel;
  if (!lm) {
    // Check if it's Chrome but API not enabled
    const isChrome = /Chrome\/(\d+)/.test(navigator.userAgent);
    const chromeVersion = isChrome ? parseInt(RegExp.$1) : 0;

    if (isChrome && chromeVersion >= 131) {
      return { status: "needs-flags" };
    }
    return { status: "unsupported-browser" };
  }

  try {
    const availability = await lm.availability();
    if (availability === "available") return { status: "available", raw: availability };
    if (availability === "downloadable") return { status: "downloadable", raw: availability };
    return { status: "unavailable", raw: availability };
  } catch {
    return { status: "unavailable" };
  }
}

export async function hasLanguageModel(): Promise<boolean> {
  const { status } = await getLanguageModelStatus();
  return status === "available" || status === "downloadable";
}

export function hasWebGPU(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

export function hasSpeechSynthesis(): boolean {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

export async function getMicrophonePermission(): Promise<"granted" | "denied" | "prompt"> {
  if (typeof navigator === "undefined" || !navigator.permissions) return "prompt";
  try {
    const result = await navigator.permissions.query({ name: "microphone" as PermissionName });
    return result.state as "granted" | "denied" | "prompt";
  } catch {
    return "prompt";
  }
}

export async function requestMicrophoneAccess(): Promise<boolean> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return true;
  } catch {
    return false;
  }
}

export async function detectCapabilities(): Promise<Capabilities> {
  return {
    speechRecognition: hasSpeechRecognition(),
    languageModel: await hasLanguageModel(),
    webGPU: hasWebGPU(),
    speechSynthesis: hasSpeechSynthesis(),
  };
}

export async function detectDetailedCapabilities(): Promise<DetailedCapabilities> {
  const lmStatus = await getLanguageModelStatus();
  const micPerm = await getMicrophonePermission();

  const lmInstructions = {
    "needs-flags": "Enable in Chrome: visit chrome://flags/#optimization-guide-on-device-model and chrome://flags/#prompt-api-for-gemini-nano, set both to Enabled, then restart Chrome.",
    "downloadable": "The AI model needs to download (~1.7GB). It will start automatically when first used.",
    "unsupported-browser": "On-device AI requires Chrome 131 or newer. Please update or switch to Chrome.",
    "unavailable": "On-device AI is not available. Try enabling the Chrome flags or restarting Chrome after enabling.",
  };

  return {
    speechRecognition: {
      status: hasSpeechRecognition() ? "available" : "unsupported-browser",
      instructions: hasSpeechRecognition() ? undefined : "Speech recognition requires Chrome or Edge.",
    },
    languageModel: {
      status: lmStatus.status,
      instructions: lmInstructions[lmStatus.status as keyof typeof lmInstructions],
    },
    webGPU: {
      status: hasWebGPU() ? "available" : "unavailable",
      instructions: hasWebGPU() ? undefined : "WebGPU not available. Kokoro TTS will use WASM (slower).",
    },
    speechSynthesis: {
      status: hasSpeechSynthesis() ? "available" : "unavailable",
    },
    microphone: {
      status: micPerm,
    },
  };
}
