import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// Dev server config for the React example app
export default defineConfig({
  plugins: [react()],
  root: "examples/react",
  resolve: {
    alias: {
      "voice-tool-call": resolve(__dirname, "src/lib/index.ts"),
    },
  },
  optimizeDeps: {
    exclude: ["node-llama-cpp", "@huggingface/transformers"],
  },
  build: {
    rollupOptions: {
      external: ["node-llama-cpp", "child_process", "os", "fs", "path"],
    },
  },
});
