// Main facade — works in both browser and Node
export { VoiceToolSystem } from "./VoiceToolSystem";
export type { VoiceToolConfig, VoiceToolEventMap, SceneDefinition } from "./VoiceToolSystem";

// Types — universal
export type {
  Transcript, ToolDefinition, ToolCall, AppContext, IntentInput,
  RegisterToolOptions, ToolExecutionResult, Capabilities,
  IntentMode, TTSMode, TTSStatus, WakeWordState,
} from "./types";

// Sub-modules — browser-safe, also work in Node
export { WakeWordListener } from "./stt/WakeWordListener";
export { listenForCommand, createSpeechRecognition } from "./stt/SpeechRecognition";
export { BrowserTTS } from "./tts/BrowserTTS";
export { TTSManager } from "./tts/TTSManager";

// KokoroTTSEngine uses dynamic import internally but Vite still resolves it.
// Use loadKokoro() for lazy access instead.
export async function loadKokoro() {
  return import("./tts/KokoroTTS");
}
export { ToolExecutor } from "./executor/ToolExecutor";
export type { ToolHandler } from "./executor/ToolExecutor";
export type { IntentInterpreter } from "./intent/types";
export { createLocalInterpreter } from "./intent/LocalInterpreter";
export { createApiInterpreter } from "./intent/ApiInterpreter";
export { createLanguageModelInterpreter, isLanguageModelAvailable } from "./intent/LanguageModelInterpreter";
export { detectCapabilities, detectDetailedCapabilities, requestMicrophoneAccess, getMicrophonePermission, getLanguageModelStatus } from "./detect";
export type { DetailedCapabilities, FeatureStatus } from "./detect";
export { TypedEventEmitter } from "./EventEmitter";

// Types for Node-only modules (always safe to export)
export type { LlamaCppConfig } from "./intent/LlamaCppInterpreter";
export type { WhisperConfig } from "./stt/WhisperSTT";

/**
 * Async loaders for Node-only modules.
 * These use dynamic import() so they don't break browser bundles.
 * In the browser, they throw a clear error.
 */
export async function loadWhisper() {
  return import("./stt/WhisperSTT");
}

export async function loadLlamaCpp() {
  return import("./intent/LlamaCppInterpreter");
}
