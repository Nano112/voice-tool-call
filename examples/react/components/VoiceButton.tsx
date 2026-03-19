type VoiceButtonProps = {
  onPress: () => void;
  isListening: boolean;
};

export function VoiceButton({ onPress, isListening }: VoiceButtonProps) {
  return (
    <button
      onClick={onPress}
      disabled={isListening}
      style={{
        padding: "16px 32px",
        fontSize: "18px",
        borderRadius: "50px",
        border: "none",
        background: isListening ? "#ef4444" : "#3b82f6",
        color: "white",
        cursor: isListening ? "not-allowed" : "pointer",
        transition: "all 0.2s",
        boxShadow: isListening
          ? "0 0 0 4px rgba(239, 68, 68, 0.3)"
          : "0 2px 8px rgba(0,0,0,0.15)",
      }}
    >
      {isListening ? "Listening..." : "Push to Talk"}
    </button>
  );
}
