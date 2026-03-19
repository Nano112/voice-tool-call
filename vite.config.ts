import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";

// Dev server config for the example app
export default defineConfig({
  plugins: [react()],
  root: "examples/react",
  resolve: {
    alias: {
      "voice-tool-call": resolve(__dirname, "src/lib/index.ts"),
    },
  },
});
