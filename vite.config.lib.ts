import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  build: {
    lib: {
      entry: resolve(__dirname, "src/lib/index.ts"),
      name: "VoiceToolCall",
      formats: ["es", "cjs"],
      fileName: (format) => `voice-tool-call.${format === "es" ? "mjs" : "cjs"}`,
    },
    rollupOptions: {
      external: ["kokoro-js"],
    },
    outDir: "dist",
    sourcemap: true,
    emptyOutDir: true,
  },
});
