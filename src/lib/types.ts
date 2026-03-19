export type Transcript = {
  text: string;
  confidence?: number;
};

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, string>;
  examples?: { input: string; arguments: Record<string, any> }[];
  keywords?: string[];
};

export type ToolCall = {
  tool: string;
  arguments: Record<string, any>;
};

export type AppContext = Record<string, any>;

export type IntentInput = {
  text: string;
  tools: ToolDefinition[];
  context: AppContext;
};

export type IntentMode = "local" | "api" | "language-model";
export type TTSMode = "browser" | "kokoro";
export type TTSStatus = "generating" | "speaking" | "done";
export type WakeWordState = "idle" | "listening" | "activated" | "processing";

export type RegisterToolOptions = {
  description: string;
  parameters: Record<string, string>;
  keywords?: string[];
  examples?: { input: string; arguments: Record<string, any> }[];
  handler: (args: Record<string, any>) => any;
};

export type ToolExecutionResult = {
  tool: string;
  arguments: Record<string, any>;
  result: any;
  error?: string;
};

export type Capabilities = {
  speechRecognition: boolean;
  languageModel: boolean;
  webGPU: boolean;
  speechSynthesis: boolean;
};
