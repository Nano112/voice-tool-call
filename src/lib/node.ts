// Node/Bun-only exports — these require Node APIs (child_process, fs, etc.)
// Import from "voice-tool-call/node"

export { createLlamaCppInterpreter } from "./intent/LlamaCppInterpreter";
export type { LlamaCppConfig, LlamaCppInterpreter } from "./intent/LlamaCppInterpreter";
export { warmUpWhisper, listenAndTranscribe, transcribeFile, recordUntilEnter, listAudioDevices, setAudioDevice } from "./stt/WhisperSTT";
export type { WhisperConfig } from "./stt/WhisperSTT";
export { KokoroTTSEngine } from "./tts/KokoroTTS";
export type { KokoroTTSOptions } from "./tts/KokoroTTS";

// Convenience async loaders
export async function loadWhisper() {
  return import("./stt/WhisperSTT");
}

export async function loadLlamaCpp() {
  return import("./intent/LlamaCppInterpreter");
}

export async function loadKokoro() {
  return import("./tts/KokoroTTS");
}

// Re-export everything from main entry
export * from "./index";
