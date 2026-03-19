// Main facade
export { VoiceToolSystem } from "./VoiceToolSystem";
export type { VoiceToolConfig, VoiceToolEventMap } from "./VoiceToolSystem";

// Types
export type {
  Transcript, ToolDefinition, ToolCall, AppContext, IntentInput,
  RegisterToolOptions, ToolExecutionResult, Capabilities,
  IntentMode, TTSMode, TTSStatus, WakeWordState,
} from "./types";

// Sub-modules for advanced users
export { WakeWordListener } from "./stt/WakeWordListener";
export { listenForCommand, createSpeechRecognition } from "./stt/SpeechRecognition";
export { BrowserTTS } from "./tts/BrowserTTS";
export { KokoroTTSEngine } from "./tts/KokoroTTS";
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
