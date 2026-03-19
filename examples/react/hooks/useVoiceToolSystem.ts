import { useEffect, useRef, useState } from "react";
import {
  VoiceToolSystem,
  type VoiceToolConfig,
  type IntentMode,
  type TTSMode,
  type WakeWordState,
  type Capabilities,
} from "voice-tool-call";

export type VoiceToolState = {
  wakeState: WakeWordState;
  intentMode: IntentMode;
  ttsMode: TTSMode;
  running: boolean;
  capabilities: Capabilities | null;
};

export function useVoiceToolSystem(config: VoiceToolConfig = {}) {
  const systemRef = useRef<VoiceToolSystem | null>(null);
  const configRef = useRef(config);
  const [state, setState] = useState<VoiceToolState>({
    wakeState: "idle",
    intentMode: config.intent ?? "local",
    ttsMode: config.tts ?? "browser",
    running: false,
    capabilities: null,
  });

  useEffect(() => {
    const system = new VoiceToolSystem(configRef.current);
    systemRef.current = system;

    system.on("wakeword", (d) => setState((s) => ({ ...s, wakeState: d.state })));
    system.on("intent:mode", (d) => setState((s) => ({ ...s, intentMode: d.mode })));
    system.on("tts:mode", (d) => setState((s) => ({ ...s, ttsMode: d.mode })));
    system.on("state", (d) => setState((s) => ({ ...s, running: d.running })));
    system.on("ready", (d) => setState((s) => ({ ...s, capabilities: d.capabilities })));

    return () => {
      system.destroy();
      systemRef.current = null;
    };
  }, []);

  return {
    system: systemRef.current,
    ...state,
  };
}
