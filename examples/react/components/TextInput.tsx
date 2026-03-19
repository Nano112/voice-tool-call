import { useState } from "react";

type TextInputProps = {
  onSubmit: (text: string) => void;
  disabled: boolean;
};

export function TextInput({ onSubmit, disabled }: TextInputProps) {
  const [text, setText] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (text.trim()) {
      onSubmit(text.trim());
      setText("");
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", gap: "8px", width: "100%", maxWidth: "640px" }}>
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder='Type a command (e.g. "switch to the desk camera")'
        disabled={disabled}
        style={{
          flex: 1,
          padding: "10px 14px",
          borderRadius: "8px",
          border: "1px solid #3d3d4f",
          background: "#1e1e2e",
          color: "#e2e8f0",
          fontSize: "14px",
          outline: "none",
        }}
      />
      <button
        type="submit"
        disabled={disabled || !text.trim()}
        style={{
          padding: "10px 20px",
          borderRadius: "8px",
          border: "none",
          background: "#8b5cf6",
          color: "white",
          fontSize: "14px",
          cursor: disabled ? "not-allowed" : "pointer",
          opacity: disabled || !text.trim() ? 0.5 : 1,
        }}
      >
        Send
      </button>
    </form>
  );
}
