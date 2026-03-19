import type { ReactNode } from "react";
import type { AppContext } from "voice-tool-call";

type ContextPanelProps = {
  context: AppContext;
};

function renderValue(key: string, value: any, context: AppContext): ReactNode {
  // Render arrays of objects as tag lists
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === "object") {
    const activeKey = Object.keys(context).find(
      (k) => k.startsWith("active") && typeof context[k] === "string"
    );
    const activeId = activeKey ? context[activeKey] : null;

    return (
      <div key={key}>
        <div style={{ fontSize: "12px", color: "#64748b", marginBottom: "6px", textTransform: "uppercase", letterSpacing: "0.5px" }}>
          {key}
        </div>
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
          {value.map((item: any) => {
            const isActive = item.id === activeId;
            return (
              <div
                key={item.id ?? item.name ?? JSON.stringify(item)}
                style={{
                  padding: "8px 14px",
                  borderRadius: "6px",
                  background: isActive ? "#3b82f6" : "#2d2d3f",
                  color: isActive ? "white" : "#94a3b8",
                  fontSize: "13px",
                  border: isActive ? "1px solid #60a5fa" : "1px solid #3d3d4f",
                }}
              >
                <div style={{ fontWeight: 600 }}>{item.name ?? item.id}</div>
                {item.description && (
                  <div style={{ fontSize: "11px", opacity: 0.7 }}>
                    {item.id ? `${item.id} — ` : ""}{item.description}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // Render scalar values as key: value
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return (
      <div key={key} style={{ fontSize: "13px", color: "#94a3b8" }}>
        <span style={{ color: "#64748b" }}>{key}:</span> {String(value)}
      </div>
    );
  }

  return null;
}

export function ContextPanel({ context }: ContextPanelProps) {
  const entries = Object.entries(context);

  return (
    <div
      style={{
        background: "#1e1e2e",
        borderRadius: "8px",
        padding: "16px",
        width: "100%",
        maxWidth: "640px",
        display: "flex",
        flexDirection: "column",
        gap: "12px",
      }}
    >
      <h3 style={{ margin: 0, color: "#94a3b8", fontSize: "14px" }}>
        Application Context
      </h3>
      {entries.map(([key, value]) => renderValue(key, value, context))}
    </div>
  );
}
