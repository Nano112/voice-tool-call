import { useEffect, useState } from "react";

export type ToastMessage = {
  id: number;
  text: string;
  type: "info" | "success" | "error";
};

type ToastProps = {
  messages: ToastMessage[];
  onDismiss: (id: number) => void;
};

const colors = {
  info: { bg: "#1e293b", border: "#3b82f6", text: "#93c5fd" },
  success: { bg: "#052e16", border: "#22c55e", text: "#86efac" },
  error: { bg: "#2d0a0a", border: "#ef4444", text: "#fca5a5" },
};

function ToastItem({ message, onDismiss }: { message: ToastMessage; onDismiss: () => void }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    const timer = setTimeout(() => {
      setVisible(false);
      setTimeout(onDismiss, 300);
    }, 4000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  const c = colors[message.type];

  return (
    <div
      style={{
        padding: "12px 20px",
        borderRadius: "8px",
        background: c.bg,
        border: `1px solid ${c.border}`,
        color: c.text,
        fontSize: "14px",
        maxWidth: "400px",
        boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
        opacity: visible ? 1 : 0,
        transform: visible ? "translateY(0)" : "translateY(-10px)",
        transition: "all 0.3s ease",
        cursor: "pointer",
      }}
      onClick={onDismiss}
    >
      {message.text}
    </div>
  );
}

export function ToastContainer({ messages, onDismiss }: ToastProps) {
  if (messages.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: "20px",
        right: "20px",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
        zIndex: 1000,
      }}
    >
      {messages.map((msg) => (
        <ToastItem key={msg.id} message={msg} onDismiss={() => onDismiss(msg.id)} />
      ))}
    </div>
  );
}
