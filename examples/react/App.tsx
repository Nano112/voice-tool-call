import { useState, useCallback, useEffect } from "react";
import type { AppContext } from "voice-tool-call";
import { detectDetailedCapabilities, requestMicrophoneAccess, type DetailedCapabilities } from "voice-tool-call";
import { useVoiceToolSystem } from "./hooks/useVoiceToolSystem";
import { VoiceButton } from "./components/VoiceButton";
import { EventLog, type LogEntry } from "./components/EventLog";
import { ContextPanel } from "./components/ContextPanel";
import { TextInput } from "./components/TextInput";
import { ToastContainer, type ToastMessage } from "./components/Toast";

let toastId = 0;

function App() {
  const [context, setContext] = useState<AppContext>({
    cameras: [
      { id: "cam1", name: "overhead", description: "top-down view" },
      { id: "cam2", name: "desk", description: "front desk view" },
      { id: "cam3", name: "whiteboard", description: "whiteboard capture" },
    ],
    activeCamera: "cam1",
  });
  const [events, setEvents] = useState<LogEntry[]>([]);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [detailed, setDetailed] = useState<DetailedCapabilities | null>(null);
  const [micGranted, setMicGranted] = useState(false);
  const [moduleStatus, setModuleStatus] = useState<Record<string, string>>({});

  const { system, wakeState } = useVoiceToolSystem({
    tts: "kokoro",
    autoDetect: true,
    autoSpeak: true,
  });

  const addLog = useCallback((type: string, text: string) => {
    setEvents((prev) => [...prev, { type, text }]);
  }, []);

  const addToast = useCallback((text: string, type: ToastMessage["type"] = "info") => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, text, type }]);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Detect capabilities on mount
  useEffect(() => {
    detectDetailedCapabilities().then((caps) => {
      setDetailed(caps);
      setMicGranted(caps.microphone.status === "granted");
    });
  }, []);

  // Register tools and wire events once system is ready
  useEffect(() => {
    if (!system) return;

    system.setContext(context);

    system.registerTool("selectCamera", {
      description: "Switch the active camera view",
      parameters: { cameraId: "string" },
      keywords: ["camera", "switch", "view", "show", "see", "look", "go to"],
      examples: [
        { input: "switch to the desk camera", arguments: { cameraId: "cam2" } },
        { input: "show me the overhead", arguments: { cameraId: "cam1" } },
        { input: "go to whiteboard", arguments: { cameraId: "cam3" } },
      ],
      handler: ({ cameraId }) => {
        setContext((prev) => ({ ...prev, activeCamera: cameraId }));
        system.updateContext({ activeCamera: cameraId });
        const cameras = context.cameras as any[];
        const cam = cameras?.find((c: any) => c.id === cameraId);
        return cam ? `Switched to the ${cam.name} camera.` : `Switched to camera ${cameraId}.`;
      },
    });

    system.registerTool("toggleRecording", {
      description: "Start or stop recording",
      parameters: { enabled: "boolean" },
      keywords: ["record", "start", "stop", "begin", "end", "pause"],
      examples: [
        { input: "start recording", arguments: { enabled: true } },
        { input: "stop recording", arguments: { enabled: false } },
      ],
      handler: ({ enabled }) => (enabled ? "Recording started." : "Recording stopped."),
    });

    system.registerTool("listCameras", {
      description: "List all available cameras and which one is active",
      parameters: {},
      keywords: ["cameras", "available", "list"],
      examples: [
        { input: "what cameras are available", arguments: {} },
        { input: "list the cameras", arguments: {} },
      ],
      handler: () => {
        const ctx = system.getContext();
        const cameras = ctx.cameras as any[];
        const names = cameras.map((c: any) => `${c.name}${c.id === ctx.activeCamera ? " (active)" : ""}`).join(", ");
        return `Available cameras: ${names}.`;
      },
    });

    system.registerTool("getActiveCamera", {
      description: "Get the currently active camera",
      parameters: {},
      keywords: ["current", "active", "which one", "selected"],
      examples: [{ input: "which camera am I on", arguments: {} }],
      handler: () => {
        const ctx = system.getContext();
        const cameras = ctx.cameras as any[];
        const cam = cameras?.find((c: any) => c.id === ctx.activeCamera);
        return cam ? `The active camera is ${cam.name}${cam.description ? `, the ${cam.description}` : ""}.` : "No camera is currently active.";
      },
    });

    system.registerTool("setBackgroundColor", {
      description: "Change the page background color",
      parameters: { color: "string" },
      keywords: ["background", "color", "theme", "dark", "light", "red", "blue", "green", "purple", "pink"],
      examples: [
        { input: "make the background red", arguments: { color: "#dc2626" } },
        { input: "change background to blue", arguments: { color: "#2563eb" } },
        { input: "set it to green", arguments: { color: "#16a34a" } },
        { input: "go dark", arguments: { color: "#0f0f1a" } },
        { input: "make it purple", arguments: { color: "#7c3aed" } },
        { input: "light mode", arguments: { color: "#f8fafc" } },
      ],
      handler: ({ color }) => {
        document.body.style.background = color;
        const root = document.getElementById("root")?.firstElementChild as HTMLElement | null;
        if (root) root.style.background = color;
        // Auto-adjust text color for light backgrounds
        const isLight = parseInt(color.replace("#", ""), 16) > 0x888888;
        if (root) root.style.color = isLight ? "#1e1e2e" : "#e2e8f0";
        return `Background changed to ${color}.`;
      },
    });

    system.registerTool("setFontSize", {
      description: "Change the base font size of the page",
      parameters: { size: "string" },
      keywords: ["font", "size", "text", "bigger", "smaller", "large", "small", "tiny", "huge"],
      examples: [
        { input: "make the text bigger", arguments: { size: "18px" } },
        { input: "smaller text please", arguments: { size: "12px" } },
        { input: "set font size to 20", arguments: { size: "20px" } },
        { input: "make it huge", arguments: { size: "24px" } },
        { input: "tiny text", arguments: { size: "10px" } },
        { input: "normal size", arguments: { size: "14px" } },
      ],
      handler: ({ size }) => {
        document.documentElement.style.fontSize = size;
        return `Font size set to ${size}.`;
      },
    });

    system.registerTool("playSound", {
      description: "Play a tone at a given frequency and duration",
      parameters: { frequency: "number", duration: "number" },
      keywords: ["sound", "tone", "beep", "play", "note", "buzz", "ping"],
      examples: [
        { input: "play a beep", arguments: { frequency: 440, duration: 300 } },
        { input: "play a low tone", arguments: { frequency: 200, duration: 500 } },
        { input: "play a high note", arguments: { frequency: 880, duration: 200 } },
        { input: "buzz", arguments: { frequency: 100, duration: 1000 } },
      ],
      handler: ({ frequency, duration }) => {
        const ctx = new AudioContext();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = frequency ?? 440;
        gain.gain.value = 0.3;
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + (duration ?? 300) / 1000);
        return `Playing ${frequency ?? 440}Hz tone for ${duration ?? 300}ms.`;
      },
    });

    system.registerTool("chat", {
      description: "Respond conversationally when no other tool matches",
      parameters: { message: "string" },
      examples: [
        { input: "two plus two", arguments: { message: "Two plus two is four." } },
        { input: "hello", arguments: { message: "Hello! How can I help you?" } },
        { input: "tell me a joke", arguments: { message: "Why did the camera go to therapy? It couldn't focus." } },
      ],
      handler: ({ message }) => message,
    });

    system.on("transcript", (t) => addLog("transcript", `"${t.text}" (confidence: ${(t.confidence ?? 0).toFixed(2)})`));
    system.on("intent", (i) => addLog("intent", JSON.stringify(i, null, 2)));
    system.on("executed", (r) => addLog("executed", r.map((x) => `${x.tool}(${JSON.stringify(x.arguments)}) → ${x.error ?? "OK"}`).join(", ")));
    system.on("response", (r) => addLog("response", r.text));
    system.on("tts:status", (s) => addLog("tts", s.status));
    system.on("loading", (l) => {
      addLog("info", `${l.module}: ${l.status}`);
      setModuleStatus((prev) => ({ ...prev, [l.module]: l.status }));
      if (l.status === "ready") addToast(`${l.module} ready!`, "success");
      if (l.status === "error") addToast(`${l.module} failed to load`, "error");
    });
    system.on("error", (e) => { addLog("error", e.error); addToast(e.error, "error"); });

    system.start();
  }, [system]);

  useEffect(() => {
    system?.setContext(context);
  }, [context, system]);

  const handleRequestMic = useCallback(async () => {
    const granted = await requestMicrophoneAccess();
    setMicGranted(granted);
    if (granted) {
      addToast("Microphone access granted!", "success");
      detectDetailedCapabilities().then(setDetailed);
    } else {
      addToast("Microphone access denied. Voice features won't work.", "error");
    }
  }, [addToast]);

  const handleTextSubmit = useCallback(async (text: string) => {
    if (!system) return;
    setIsProcessing(true);
    try { await system.processText(text); } catch {} finally { setIsProcessing(false); }
  }, [system]);

  const stateLabel =
    wakeState === "activated" ? "Wake word detected — listening for command..."
    : wakeState === "listening" ? 'Listening for "Hey Assistant"...'
    : null;

  return (
    <div style={{ minHeight: "100vh", background: "#0f0f1a", color: "#e2e8f0", display: "flex", flexDirection: "column", alignItems: "center", padding: "40px 20px", gap: "24px", fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <ToastContainer messages={toasts} onDismiss={dismissToast} />

      <h1 style={{ margin: 0, fontSize: "24px", fontWeight: 600 }}>Voice Tool Calling</h1>
      <p style={{ margin: 0, color: "#64748b", fontSize: "14px" }}>
        Say <strong style={{ color: "#a78bfa" }}>"Hey Assistant"</strong> + a command, hold{" "}
        <strong style={{ color: "#a78bfa" }}>Space</strong>, or type below.
      </p>

      {/* Capabilities Panel */}
      {/* Loading Status Bar */}
      <div style={{ display: "flex", gap: "16px", fontSize: "12px", color: "#64748b", background: "#1e1e2e", padding: "10px 20px", borderRadius: "8px", flexWrap: "wrap", justifyContent: "center" }}>
        <StatusDot label="Wake Word" status={wakeState === "listening" || wakeState === "activated" ? "active" : "starting..."} />
        <StatusDot label="AI Intent" status={moduleStatus["language-model"] ?? "waiting..."} />
        <StatusDot label="Kokoro TTS" status={moduleStatus["kokoro"] ?? "waiting..."} />
      </div>

      {detailed && <CapabilitiesPanel detailed={detailed} micGranted={micGranted} onRequestMic={handleRequestMic} />}

      <ContextPanel context={context} />

      <VoiceButton
        onPress={async () => {
          if (!system) return;
          if (!micGranted) { await handleRequestMic(); return; }
          setIsProcessing(true);
          try { await system.pushToTalk(); } catch {} finally { setIsProcessing(false); }
        }}
        isListening={isProcessing || wakeState === "activated"}
      />

      {stateLabel && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", color: wakeState === "activated" ? "#22c55e" : "#64748b", fontSize: "13px" }}>
          <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: wakeState === "activated" ? "#22c55e" : "#3b82f6", animation: "pulse 1.5s infinite" }} />
          {stateLabel}
        </div>
      )}

      <TextInput onSubmit={handleTextSubmit} disabled={isProcessing || !system} />
      <EventLog events={events} />

      {events.length > 0 && (
        <button onClick={() => setEvents([])} style={{ padding: "8px 16px", borderRadius: "6px", border: "1px solid #3d3d4f", background: "transparent", color: "#64748b", fontSize: "12px", cursor: "pointer" }}>
          Clear Log
        </button>
      )}

      <style>{`@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
    </div>
  );
}

// --- Capabilities Panel ---

const statusIcons: Record<string, string> = {
  available: "✓", granted: "✓", active: "✓",
  downloadable: "↓", loading: "⟳",
  "needs-flags": "⚑", prompt: "?",
  unavailable: "✗", denied: "✗", "unsupported-browser": "✗",
};
const statusColors: Record<string, string> = {
  available: "#22c55e", granted: "#22c55e", active: "#22c55e",
  downloadable: "#f59e0b", loading: "#f59e0b",
  "needs-flags": "#f59e0b", prompt: "#3b82f6",
  unavailable: "#64748b", denied: "#ef4444", "unsupported-browser": "#64748b",
};

function CapabilitiesPanel({
  detailed, micGranted, onRequestMic,
}: {
  detailed: DetailedCapabilities; micGranted: boolean; onRequestMic: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  type Feature = { key: string; label: string; status: string; instructions?: string; action?: () => void; actionLabel?: string };

  const features: Feature[] = [
    { key: "microphone", label: "Microphone", status: detailed.microphone.status, action: !micGranted && detailed.microphone.status === "prompt" ? onRequestMic : undefined, actionLabel: "Grant Access" },
    { key: "speechRecognition", label: "Speech Recognition", status: detailed.speechRecognition.status, instructions: detailed.speechRecognition.instructions },
    { key: "languageModel", label: "On-Device AI (Gemini Nano)", status: detailed.languageModel.status, instructions: detailed.languageModel.instructions },
    { key: "webGPU", label: "WebGPU Acceleration", status: detailed.webGPU.status, instructions: detailed.webGPU.instructions },
    { key: "speechSynthesis", label: "Speech Synthesis", status: detailed.speechSynthesis.status },
  ];

  return (
    <div style={{ background: "#1e1e2e", borderRadius: "8px", padding: "14px 18px", width: "100%", maxWidth: "640px", fontSize: "13px" }}>
      <div style={{ color: "#94a3b8", fontSize: "12px", textTransform: "uppercase", letterSpacing: "0.5px", marginBottom: "10px" }}>
        System Capabilities
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {features.map((f) => (
          <div key={f.key}>
            <div
              style={{ display: "flex", alignItems: "center", gap: "8px", cursor: f.instructions ? "pointer" : "default" }}
              onClick={() => f.instructions && setExpanded(expanded === f.key ? null : f.key)}
            >
              <span style={{ color: statusColors[f.status] ?? "#64748b", fontWeight: 600, width: "16px", textAlign: "center" }}>
                {statusIcons[f.status] ?? "?"}
              </span>
              <span style={{ color: "#e2e8f0", flex: 1 }}>{f.label}</span>
              <span style={{ color: statusColors[f.status] ?? "#64748b", fontSize: "11px" }}>
                {f.status}
              </span>
              {f.action && (
                <button
                  onClick={(e) => { e.stopPropagation(); f.action!(); }}
                  style={{ padding: "3px 10px", borderRadius: "4px", border: "none", background: "#3b82f6", color: "white", fontSize: "11px", cursor: "pointer" }}
                >
                  {f.actionLabel}
                </button>
              )}
              {f.instructions && (
                <span style={{ color: "#475569", fontSize: "11px" }}>{expanded === f.key ? "▲" : "▼"}</span>
              )}
            </div>
            {expanded === f.key && f.instructions && (
              <div style={{ marginLeft: "24px", marginTop: "4px", padding: "8px 12px", background: "#16162a", borderRadius: "4px", color: "#94a3b8", fontSize: "12px", lineHeight: "1.5" }}>
                {f.instructions}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusDot({ label, status }: { label: string; status: string }) {
  const color = statusColors[status] ?? (status.includes("wait") || status.includes("start") ? "#f59e0b" : "#475569");
  const isLoading = status === "loading" || status.includes("wait") || status.includes("start");
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: color, animation: isLoading ? "pulse 1s infinite" : "none", boxShadow: status === "active" || status === "ready" ? `0 0 6px ${color}` : "none" }} />
      <span>{label}: <span style={{ color }}>{status}</span></span>
    </div>
  );
}

export default App;
