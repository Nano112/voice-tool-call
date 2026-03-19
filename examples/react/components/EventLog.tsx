export type LogEntry = {
  type: string;
  text: string;
};

type EventLogProps = {
  events: LogEntry[];
};

const colors: Record<string, string> = {
  listening: "#94a3b8",
  transcript: "#60a5fa",
  intent: "#a78bfa",
  executed: "#34d399",
  response: "#fbbf24",
  tts: "#fb923c",
  error: "#f87171",
  info: "#94a3b8",
};

export function EventLog({ events }: EventLogProps) {
  return (
    <div
      style={{
        background: "#1e1e2e",
        borderRadius: "8px",
        padding: "16px",
        fontFamily: "monospace",
        fontSize: "13px",
        maxHeight: "400px",
        overflowY: "auto",
        width: "100%",
        maxWidth: "640px",
      }}
    >
      {events.length === 0 ? (
        <div style={{ color: "#64748b" }}>No events yet. Say "Hey Assistant" or type a command.</div>
      ) : (
        events.map((event, i) => (
          <div key={i} style={{ color: colors[event.type] ?? "#94a3b8", marginBottom: "6px", whiteSpace: "pre-wrap" }}>
            <span style={{ color: "#475569", marginRight: "8px" }}>[{event.type}]</span>
            {event.text}
          </div>
        ))
      )}
    </div>
  );
}
