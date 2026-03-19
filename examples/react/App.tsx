import { useState, useCallback, useEffect, useRef } from "react";
import type { VoiceToolSystem as VTSystem } from "voice-tool-call";
import { useVoiceToolSystem } from "./hooks/useVoiceToolSystem";
import { EventLog, type LogEntry } from "./components/EventLog";
import { ToastContainer, type ToastMessage } from "./components/Toast";

let toastId = 0;

// --- Page definitions as scenes ---

function registerScenes(system: VTSystem, setPage: (p: string) => void) {

  // Global tools — available on ALL pages
  system.registerGlobalTool("navigate", {
    description: "Navigate to a different page",
    parameters: { page: "string" },
    keywords: ["go to", "open", "navigate", "switch", "page"],
    examples: [
      { input: "go to the dashboard", arguments: { page: "dashboard" } },
      { input: "open the music player", arguments: { page: "player" } },
      { input: "go to settings", arguments: { page: "settings" } },
    ],
    handler: ({ page }) => {
      const name = page.toLowerCase().trim();
      if (system.getScenes().includes(name)) {
        system.setScene(name);
        setPage(name);
        return "Navigated to " + name + ".";
      }
      return "Unknown page: " + page + ". Available: " + system.getScenes().join(", ") + ".";
    },
  });

  system.registerGlobalTool("chat", {
    description: "Respond conversationally when no other tool matches",
    parameters: { message: "string" },
    examples: [
      { input: "hello", arguments: { message: "Hello! I can navigate pages, control the player, adjust settings, and more." } },
      { input: "what page am I on", arguments: { message: "Let me check..." } },
      { input: "what can you do", arguments: { message: "I can navigate between pages, control music, adjust settings, and manage your dashboard." } },
    ],
    handler: ({ message }) => message,
  });

  system.registerGlobalTool("currentPage", {
    description: "Tell the user which page they're on and what they can do here",
    parameters: {},
    keywords: ["where", "which page", "what page"],
    examples: [{ input: "where am I", arguments: {} }],
    handler: () => {
      const scene = system.getScene();
      const tools = system.getToolDefinitions().filter(t => !["navigate", "chat", "currentPage"].includes(t.name));
      return "You're on the " + scene + " page. Available actions: " + tools.map(t => t.description.toLowerCase()).join(", ") + ".";
    },
  });

  // --- Dashboard Scene ---
  system.defineScene("dashboard", {
    context: { currentPage: "dashboard", widgets: ["revenue", "users", "orders"] },
    tools: {
      viewWidget: {
        description: "View or focus on a dashboard widget",
        parameters: { widget: "string" },
        keywords: ["show", "view", "widget", "chart", "graph"],
        examples: [
          { input: "show me the revenue chart", arguments: { widget: "revenue" } },
          { input: "view users", arguments: { widget: "users" } },
        ],
        handler: ({ widget }) => "Focused on the " + widget + " widget.",
      },
      refreshData: {
        description: "Refresh the dashboard data",
        parameters: {},
        keywords: ["refresh", "reload", "update"],
        examples: [{ input: "refresh the dashboard", arguments: {} }],
        handler: () => "Dashboard data refreshed.",
      },
      exportReport: {
        description: "Export a report as CSV or PDF",
        parameters: { format: "string" },
        keywords: ["export", "download", "report", "csv", "pdf"],
        examples: [
          { input: "export as csv", arguments: { format: "csv" } },
          { input: "download the report", arguments: { format: "pdf" } },
        ],
        handler: ({ format }) => "Exported report as " + (format || "pdf").toUpperCase() + ".",
      },
    },
  });

  // --- Player Scene ---
  system.defineScene("player", {
    context: {
      currentPage: "player",
      queue: [{ id: "1", title: "Bohemian Rhapsody" }, { id: "2", title: "Stairway to Heaven" }],
      nowPlaying: "Bohemian Rhapsody",
      paused: false,
    },
    tools: {
      play: {
        description: "Play a song by title",
        parameters: { query: "string" },
        keywords: ["play", "put on", "listen"],
        examples: [
          { input: "play something chill", arguments: { query: "chill vibes" } },
          { input: "play bohemian rhapsody", arguments: { query: "bohemian rhapsody" } },
        ],
        handler: ({ query }) => "Now playing: \"" + query + "\".",
      },
      skip: {
        description: "Skip to the next song",
        parameters: {},
        keywords: ["skip", "next"],
        examples: [{ input: "next song", arguments: {} }],
        handler: () => "Skipped to next track.",
      },
      pause: {
        description: "Pause or resume playback",
        parameters: {},
        keywords: ["pause", "resume", "stop"],
        examples: [{ input: "pause the music", arguments: {} }],
        handler: () => "Toggled playback.",
      },
      setVolume: {
        description: "Set the volume level (0-100)",
        parameters: { level: "number" },
        keywords: ["volume", "louder", "quieter", "mute"],
        examples: [
          { input: "turn it up", arguments: { level: 80 } },
          { input: "mute", arguments: { level: 0 } },
        ],
        handler: ({ level }) => (level ?? 50) === 0 ? "Muted." : "Volume set to " + (level ?? 50) + "%.",
      },
    },
  });

  // --- Settings Scene ---
  system.defineScene("settings", {
    context: { currentPage: "settings", theme: "dark", notifications: true, language: "en" },
    tools: {
      setTheme: {
        description: "Change the app theme",
        parameters: { theme: "string" },
        keywords: ["theme", "dark", "light", "mode"],
        examples: [
          { input: "switch to light mode", arguments: { theme: "light" } },
          { input: "dark theme", arguments: { theme: "dark" } },
        ],
        handler: ({ theme }) => "Theme changed to " + theme + ".",
      },
      toggleNotifications: {
        description: "Turn notifications on or off",
        parameters: { enabled: "boolean" },
        keywords: ["notifications", "alerts", "notify"],
        examples: [
          { input: "turn off notifications", arguments: { enabled: false } },
          { input: "enable alerts", arguments: { enabled: true } },
        ],
        handler: ({ enabled }) => "Notifications " + (enabled ? "enabled" : "disabled") + ".",
      },
      setLanguage: {
        description: "Change the app language",
        parameters: { language: "string" },
        keywords: ["language", "locale", "french", "spanish", "english"],
        examples: [
          { input: "switch to french", arguments: { language: "fr" } },
          { input: "set language to spanish", arguments: { language: "es" } },
        ],
        handler: ({ language }) => "Language set to " + language + ".",
      },
    },
  });
}

// --- Main App ---

function App() {
  const [page, setPage] = useState("dashboard");
  const [events, setEvents] = useState<LogEntry[]>([]);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [moduleStatus, setModuleStatus] = useState<Record<string, string>>({});
  const initialized = useRef(false);

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

  

  useEffect(() => {
    if (!system || initialized.current) return;
    initialized.current = true;

    registerScenes(system, setPage);
    system.setScene("dashboard"); // Start on dashboard

    // Wire events
    system.on("transcript", (t) => addLog("transcript", '"' + t.text + '" (confidence: ' + (t.confidence ?? 0).toFixed(2) + ')'));
    system.on("intent", (i) => addLog("intent", JSON.stringify(i, null, 2)));
    system.on("executed", (r) => addLog("executed", r.map((x) => x.tool + "(" + JSON.stringify(x.arguments) + ") → " + (x.error ?? "OK")).join(", ")));
    system.on("response", (r) => addLog("response", r.text));
    system.on("tts:status", (s) => addLog("tts", s.status));
    system.on("scene", (s) => addLog("info", "Scene: " + s.scene));
    system.on("loading", (l) => {
      addLog("info", l.module + ": " + l.status);
      setModuleStatus((prev) => ({ ...prev, [l.module]: l.status }));
      if (l.status === "ready") addToast(l.module + " ready!", "success");
    });
    system.on("error", (e) => { addLog("error", e.error); addToast(e.error, "error"); });

    system.start();
  }, [system]);

  const handleTextSubmit = useCallback(async (text: string) => {
    if (!system) return;
    setIsProcessing(true);
    try { await system.processText(text); } catch {} finally { setIsProcessing(false); }
  }, [system]);

  const stateLabel =
    wakeState === "activated" ? "Wake word detected — listening..."
    : wakeState === "listening" ? 'Listening for "Hey Assistant"...'
    : null;

  const pages = ["dashboard", "player", "settings"];

  return (
    <div style={{ minHeight: "100vh", background: "#0f0f1a", color: "#e2e8f0", display: "flex", flexDirection: "column", alignItems: "center", padding: "40px 20px", gap: "20px", fontFamily: "system-ui" }}>
      <ToastContainer messages={toasts} onDismiss={dismissToast} />

      <h1 style={{ margin: 0, fontSize: "24px", fontWeight: 600 }}>Voice Tool Call — Multi-Page Demo</h1>
      <p style={{ margin: 0, color: "#64748b", fontSize: "13px" }}>
        Say <b style={{ color: "#a78bfa" }}>"Hey Assistant"</b> + command. Tools change per page.
      </p>

      {/* Status */}
      <div style={{ display: "flex", gap: "16px", fontSize: "12px", color: "#64748b", background: "#1e1e2e", padding: "10px 20px", borderRadius: "8px", flexWrap: "wrap", justifyContent: "center" }}>
        <StatusDot label="Wake Word" status={wakeState === "listening" || wakeState === "activated" ? "active" : "starting..."} />
        <StatusDot label="AI Intent" status={moduleStatus["language-model"] ?? "waiting..."} />
        <StatusDot label="Kokoro TTS" status={moduleStatus["kokoro"] ?? "waiting..."} />
      </div>

      {/* Page tabs */}
      <div style={{ display: "flex", gap: "4px", background: "#1e1e2e", borderRadius: "10px", padding: "4px" }}>
        {pages.map((p) => (
          <button
            key={p}
            onClick={() => { system?.setScene(p); setPage(p); }}
            style={{
              padding: "10px 24px", borderRadius: "8px", border: "none",
              background: page === p ? "#3b82f6" : "transparent",
              color: page === p ? "white" : "#64748b",
              fontSize: "14px", fontWeight: page === p ? 600 : 400, cursor: "pointer",
              transition: "all 0.2s",
            }}
          >
            {p.charAt(0).toUpperCase() + p.slice(1)}
          </button>
        ))}
      </div>

      {/* Current page info */}
      <PageContent page={page} />

      {stateLabel && (
        <div style={{ display: "flex", alignItems: "center", gap: "8px", color: wakeState === "activated" ? "#22c55e" : "#64748b", fontSize: "13px" }}>
          <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: wakeState === "activated" ? "#22c55e" : "#3b82f6", animation: "pulse 1.5s infinite" }} />
          {stateLabel}
        </div>
      )}

      {/* Text input */}
      <div style={{ display: "flex", gap: "8px", width: "100%", maxWidth: "640px" }}>
        <input
          id="cmd"
          type="text"
          placeholder={'Try: "go to player" or "show the revenue chart"'}
          disabled={isProcessing}
          onKeyDown={(e) => { if (e.key === "Enter") { const t = (e.target as HTMLInputElement).value.trim(); if (t) { handleTextSubmit(t); (e.target as HTMLInputElement).value = ""; } } }}
          style={{ flex: 1, padding: "10px 14px", borderRadius: "8px", border: "1px solid #3d3d4f", background: "#1e1e2e", color: "#e2e8f0", fontSize: "14px", outline: "none" }}
        />
        <button
          onClick={() => { const el = document.getElementById("cmd") as HTMLInputElement; const t = el.value.trim(); if (t) { handleTextSubmit(t); el.value = ""; } }}
          style={{ padding: "10px 20px", borderRadius: "8px", border: "none", background: "#8b5cf6", color: "white", fontSize: "14px", cursor: "pointer" }}
        >Send</button>
      </div>

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

// --- Page content panels ---

function PageContent({ page }: { page: string }) {
  const panels: Record<string, { icon: string; title: string; tools: string[] }> = {
    dashboard: { icon: "📊", title: "Dashboard", tools: ["viewWidget", "refreshData", "exportReport"] },
    player: { icon: "🎵", title: "Music Player", tools: ["play", "skip", "pause", "setVolume"] },
    settings: { icon: "⚙️", title: "Settings", tools: ["setTheme", "toggleNotifications", "setLanguage"] },
  };
  const p = panels[page];
  if (!p) return null;

  return (
    <div style={{ background: "#1e1e2e", borderRadius: "10px", padding: "20px", width: "100%", maxWidth: "640px" }}>
      <div style={{ fontSize: "18px", fontWeight: 600, marginBottom: "8px" }}>{p.icon} {p.title}</div>
      <div style={{ color: "#64748b", fontSize: "13px", marginBottom: "12px" }}>
        Available voice commands on this page:
      </div>
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
        {p.tools.map((t) => (
          <span key={t} style={{ padding: "4px 12px", borderRadius: "6px", background: "#2d2d3f", color: "#a78bfa", fontSize: "12px" }}>{t}</span>
        ))}
        <span style={{ padding: "4px 12px", borderRadius: "6px", background: "#1a3a2a", color: "#34d399", fontSize: "12px" }}>navigate</span>
        <span style={{ padding: "4px 12px", borderRadius: "6px", background: "#1a3a2a", color: "#34d399", fontSize: "12px" }}>chat</span>
      </div>
    </div>
  );
}

// --- Status dot ---

const statusColors: Record<string, string> = {
  available: "#22c55e", active: "#22c55e", ready: "#22c55e",
  loading: "#f59e0b", "waiting...": "#f59e0b", "starting...": "#f59e0b",
  unavailable: "#64748b", error: "#ef4444",
};

function StatusDot({ label, status }: { label: string; status: string }) {
  const color = statusColors[status] ?? "#475569";
  const isLoading = status.includes("wait") || status.includes("start") || status === "loading";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
      <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: color, animation: isLoading ? "pulse 1s infinite" : "none", boxShadow: status === "active" || status === "ready" ? "0 0 6px " + color : "none" }} />
      <span>{label}: <span style={{ color }}>{status}</span></span>
    </div>
  );
}

export default App;
