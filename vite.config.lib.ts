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
      external: [
        "kokoro-js",
        "node-llama-cpp",
        "@huggingface/transformers",
        "child_process",
        "os",
        "fs",
        "path",
      ],
    },
    outDir: "dist",
    sourcemap: true,
    emptyOutDir: true,
  },
});
