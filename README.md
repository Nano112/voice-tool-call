# voice-tool-call

Voice-to-tool-call library for the browser. Wake word detection, speech-to-text, LLM intent interpretation, tool execution, and text-to-speech — all running locally.

```
Microphone → Wake Word → STT → LLM Intent → Tool Execution → TTS Response
```

## Install

```bash
npm install voice-tool-call

# Optional: high-quality local TTS (82M param model, runs in-browser)
npm install kokoro-js
```

## Quick Start

```js
import { VoiceToolSystem } from 'voice-tool-call';

const system = new VoiceToolSystem({
  wakeWords: ['hey assistant'],
  tts: 'browser',       // or 'kokoro' for neural TTS
  autoDetect: true,      // auto-detect Chrome LanguageModel API + WebGPU
  autoSpeak: true,       // speak tool results via TTS
});

system.registerTool('setVolume', {
  description: 'Set the audio volume level',
  parameters: { level: 'number' },
  keywords: ['volume', 'louder', 'quieter', 'mute'],
  examples: [
    { input: 'turn it up', arguments: { level: 80 } },
    { input: 'mute', arguments: { level: 0 } },
  ],
  handler: ({ level }) => {
    document.querySelector('video').volume = level / 100;
    return `Volume set to ${level}%.`;
  },
});

system.on('transcript', (t) => console.log('Heard:', t.text));
system.on('executed', (r) => console.log('Result:', r));

system.start();
```

Say **"Hey Assistant, turn it up"** and the tool executes.

## How It Works

1. **Wake Word** — Continuous listening via Web Speech API. Detects your wake phrase, then captures the command.
2. **Speech-to-Text** — Web Speech API converts voice to text.
3. **Intent Interpretation** — Matches the transcript to a registered tool:
   - `local` — Keyword matching (zero latency, works offline)
   - `language-model` — Chrome's built-in Gemini Nano (on-device, no API key)
   - `api` — Any OpenAI-compatible endpoint
4. **Tool Execution** — Calls the matched tool's handler with parsed arguments.
5. **TTS Response** — Speaks the result back via browser `speechSynthesis` or Kokoro neural TTS.

## Configuration

```ts
const system = new VoiceToolSystem({
  // Wake word
  wakeWords: ['hey assistant', 'hey computer'],
  commandTimeout: 10000,
  lang: 'en-US',

  // Intent interpretation
  intent: 'local',         // 'local' | 'language-model' | 'api'
  apiUrl: '',              // for intent: 'api'
  apiKey: '',              // for intent: 'api'

  // Text-to-speech
  tts: 'browser',          // 'browser' | 'kokoro'
  kokoro: {
    voice: 'af_heart',
    dtype: 'q4',           // 'fp32' | 'fp16' | 'q8' | 'q4'
    device: 'wasm',        // 'wasm' | 'webgpu' (auto-detected)
  },

  // Behavior
  autoDetect: true,
  autoSpeak: true,
});
```

## Registering Tools

```ts
system.registerTool('toolName', {
  description: 'What this tool does',
  parameters: { param1: 'string', param2: 'number' },

  // For local keyword matching
  keywords: ['keyword1', 'keyword2'],

  // For LLM few-shot matching
  examples: [
    { input: 'user might say this', arguments: { param1: 'value', param2: 42 } },
  ],

  // Return a string to auto-speak it
  handler: ({ param1, param2 }) => {
    return `Done with ${param1}.`;
  },
});
```

### Multi-Tool Calls

The LLM interpreter can return multiple tool calls from a single command:

```
"Make the background blue and play a sound"
→ [setBackgroundColor({ color: "#2563eb" }), playSound({ frequency: 440 })]
```

### Conversation Memory

The LLM interpreter remembers recent commands, so corrections work:

```
"Play a tone at 440 hertz for 500 milliseconds"  → playSound(440, 500)
"I said 500 seconds not milliseconds"            → playSound(440, 500000)
```

### Chat Fallback

Register a `chat` tool to handle anything that doesn't match:

```ts
system.registerTool('chat', {
  description: 'Respond conversationally when no other tool matches',
  parameters: { message: 'string' },
  examples: [
    { input: 'hello', arguments: { message: 'Hello! How can I help?' } },
  ],
  handler: ({ message }) => message,
});
```

## Events

```ts
system.on('wakeword', ({ state }) => {});        // 'idle' | 'listening' | 'activated'
system.on('transcript', ({ text }) => {});        // STT result
system.on('intent', (toolCall) => {});            // parsed tool call(s)
system.on('executed', (results) => {});           // execution results
system.on('response', ({ text }) => {});          // spoken response text
system.on('tts:status', ({ status }) => {});      // 'generating' | 'speaking' | 'done'
system.on('tts:mode', ({ mode }) => {});          // TTS mode changed
system.on('intent:mode', ({ mode }) => {});       // intent mode changed
system.on('loading', ({ module, status }) => {}); // model loading progress
system.on('error', ({ error, source }) => {});    // errors
system.on('state', ({ running }) => {});          // system start/stop
system.on('ready', ({ capabilities }) => {});     // detected capabilities
```

## Methods

```ts
// Lifecycle
system.start();                     // Start wake word + auto-detect
system.stop();                      // Stop listening
system.destroy();                   // Stop + cleanup

// Input
system.processText('do something'); // Process text directly (skip voice)
system.pushToTalk();                // One-shot voice capture (no wake word)

// TTS
system.speak('Hello');              // Speak via current TTS engine
system.stopSpeaking();
system.preloadKokoro();             // Pre-download Kokoro model

// Context (dynamic state passed to LLM)
system.setContext({ key: 'value' });
system.updateContext({ key: 'v2' });

// Runtime config
system.setIntentMode('language-model');
system.setTTSMode('kokoro');
system.getCapabilities();
```

## Context

Pass dynamic application state to the LLM for smarter intent resolution:

```ts
system.setContext({
  cameras: [
    { id: 'cam1', name: 'lobby' },
    { id: 'cam2', name: 'parking' },
  ],
  activeCamera: 'cam1',
});
```

"Switch to parking" resolves to `cam2` because the LLM sees it in context.

## Capability Detection

```ts
import { detectDetailedCapabilities, requestMicrophoneAccess } from 'voice-tool-call';

const caps = await detectDetailedCapabilities();
// caps.speechRecognition.status  — 'available' | 'unsupported-browser'
// caps.languageModel.status      — 'available' | 'needs-flags' | 'downloadable'
// caps.languageModel.instructions — how to enable (if not available)
// caps.microphone.status         — 'granted' | 'denied' | 'prompt'

const granted = await requestMicrophoneAccess();
```

### Enabling Chrome LanguageModel API (Gemini Nano)

For on-device AI intent matching with no API key:

1. Chrome 131+
2. Enable `chrome://flags/#optimization-guide-on-device-model`
3. Enable `chrome://flags/#prompt-api-for-gemini-nano`
4. Restart Chrome (model downloads ~1.7GB, one-time)

The library auto-detects and switches from keyword matching to AI.

## Advanced: Individual Modules

Import individual pieces for custom pipelines:

```ts
import {
  WakeWordListener,
  listenForCommand,
  createLocalInterpreter,
  createLanguageModelInterpreter,
  ToolExecutor,
  BrowserTTS,
  KokoroTTSEngine,
  TTSManager,
} from 'voice-tool-call';
```

## Framework Support

The library is framework-agnostic — works with React, Vue, Svelte, vanilla JS, Laravel Blade, or anything that runs in a browser.

For React, see the example app in [`examples/react/`](./examples/react/).

## Browser Support

| Feature | Chrome | Edge | Firefox | Safari |
|---|---|---|---|---|
| Speech Recognition | ✓ | ✓ | ✗ | ✗ |
| LanguageModel API | 131+ | ✗ | ✗ | ✗ |
| WebGPU (Kokoro accel) | 113+ | 113+ | Nightly | Preview |
| Speech Synthesis | ✓ | ✓ | ✓ | ✓ |
| Kokoro TTS (WASM) | ✓ | ✓ | ✓ | ✓ |

Best experience: **Chrome 131+** with LanguageModel flags enabled.

## License

MIT
