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
export { ToolExecutor } from "./executor/ToolExecutor";
export type { ToolHandler } from "./executor/ToolExecutor";
export type { IntentInterpreter } from "./intent/types";
export { createLocalInterpreter } from "./intent/LocalInterpreter";
export { createApiInterpreter } from "./intent/ApiInterpreter";
export { createLanguageModelInterpreter, isLanguageModelAvailable } from "./intent/LanguageModelInterpreter";
export { detectCapabilities, detectDetailedCapabilities, requestMicrophoneAccess, getMicrophonePermission, getLanguageModelStatus } from "./detect";
export type { DetailedCapabilities, FeatureStatus } from "./detect";
export { TypedEventEmitter } from "./EventEmitter";

// Types for Node-only modules (type-only exports are safe)
export type { LlamaCppConfig } from "./intent/LlamaCppInterpreter";
export type { WhisperConfig } from "./stt/WhisperSTT";

// Node-only loaders (loadWhisper, loadLlamaCpp, loadKokoro) are in "voice-tool-call/node"
// Do NOT re-export them here — dynamic import() of Node modules breaks browser bundlers
