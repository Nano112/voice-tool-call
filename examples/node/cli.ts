#!/usr/bin/env bun
/**
 * Interactive CLI demo for voice-tool-call.
 * Run: bun examples/node/cli.ts
 *
 * Features:
 *  - Press Enter to start voice recording, Enter again to stop
 *  - Or type commands directly
 *  - Local LLM (Metal/CUDA) for intent resolution
 *  - Local Whisper for speech-to-text
 *  - Real OS tools: open apps, run commands, get system info, etc.
 */

import { VoiceToolSystem } from "../../src/lib/node";
import { warmUpWhisper, recordUntilEnter, transcribeFile, listAudioDevices, setAudioDevice } from "../../src/lib/node";
import { execSync } from "child_process";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

const isMac = process.platform === "darwin";

const c = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  blue: "\x1b[34m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
};

console.log(`
${c.bold}${c.cyan}Voice Tool Call — CLI Demo${c.reset}
${c.dim}Local LLM + Whisper STT + OS tools — fully offline${c.reset}
`);

const system = new VoiceToolSystem({
  intent: "llama-cpp",
  autoSpeak: false,
  autoDetect: false,
  llamaCpp: { gpuLayers: -1 },
});

// --- Register OS tools ---

system.registerTool("openApp", {
  description: "Open an application by name",
  parameters: { name: "string" },
  keywords: ["open", "launch", "start"],
  examples: [
    { input: "open Safari", arguments: { name: "Safari" } },
    { input: "launch Terminal", arguments: { name: "Terminal" } },
    { input: "open Spotify", arguments: { name: "Spotify" } },
  ],
  handler: ({ name }) => {
    if (isMac) {
      try { execSync(`open -a "${name}"`, { stdio: "ignore" }); return `Opened ${name}.`; }
      catch { return `Could not find app "${name}".`; }
    }
    return "App launching only supported on macOS.";
  },
});

system.registerTool("openUrl", {
  description: "Open a URL in the default browser",
  parameters: { url: "string" },
  keywords: ["browse", "go to", "visit", "website", "google", "search"],
  examples: [
    { input: "open google", arguments: { url: "https://google.com" } },
    { input: "search for cats", arguments: { url: "https://google.com/search?q=cats" } },
  ],
  handler: ({ url }) => {
    const full = url.startsWith("http") ? url : `https://${url}`;
    try { execSync(`open "${full}"`, { stdio: "ignore" }); return `Opened ${full}.`; }
    catch { return `Failed to open ${url}.`; }
  },
});

system.registerTool("runCommand", {
  description: "Run a shell command and return the output",
  parameters: { command: "string" },
  keywords: ["run", "execute", "shell", "command"],
  examples: [
    { input: "run ls", arguments: { command: "ls" } },
    { input: "show disk usage", arguments: { command: "df -h" } },
  ],
  handler: ({ command }) => {
    try {
      const output = execSync(command, { encoding: "utf-8", timeout: 5000 }).trim();
      return output.length > 500 ? output.slice(0, 500) + "..." : output;
    } catch (err: any) { return `Command failed: ${err.message}`; }
  },
});

system.registerTool("systemInfo", {
  description: "Get system information like CPU, memory, uptime",
  parameters: {},
  keywords: ["system", "info", "cpu", "memory", "ram", "uptime", "specs"],
  examples: [
    { input: "system info", arguments: {} },
    { input: "how much RAM do I have", arguments: {} },
  ],
  handler: () => {
    const totalMem = (os.totalmem() / 1024 / 1024 / 1024).toFixed(1);
    const freeMem = (os.freemem() / 1024 / 1024 / 1024).toFixed(1);
    const cpus = os.cpus();
    return [
      `Platform: ${os.platform()} ${os.arch()}`,
      `CPU: ${cpus[0]?.model ?? "unknown"} (${cpus.length} cores)`,
      `Memory: ${freeMem}GB free / ${totalMem}GB total`,
      `Uptime: ${(os.uptime() / 3600).toFixed(1)} hours`,
    ].join("\n");
  },
});

system.registerTool("listFiles", {
  description: "List files in a directory",
  parameters: { directory: "string" },
  keywords: ["list", "files", "directory", "folder", "ls"],
  examples: [
    { input: "list files here", arguments: { directory: "." } },
    { input: "what's on the desktop", arguments: { directory: "~/Desktop" } },
  ],
  handler: ({ directory }) => {
    const dir = (directory ?? ".").replace("~", os.homedir());
    try {
      const files = fs.readdirSync(dir).slice(0, 30);
      return files.map((f) => {
        try { return fs.statSync(path.join(dir, f)).isDirectory() ? `📁 ${f}` : `📄 ${f}`; }
        catch { return `   ${f}`; }
      }).join("\n");
    } catch { return `Cannot access: ${directory}`; }
  },
});

system.registerTool("setVolume", {
  description: "Set the system volume (0-100)",
  parameters: { level: "number" },
  keywords: ["volume", "louder", "quieter", "mute"],
  examples: [
    { input: "set volume to 50", arguments: { level: 50 } },
    { input: "mute", arguments: { level: 0 } },
  ],
  handler: ({ level }) => {
    if (!isMac) return "Volume control only on macOS.";
    const vol = Math.max(0, Math.min(100, level ?? 50));
    execSync(`osascript -e "set volume output volume ${vol}"`);
    return vol === 0 ? "Muted." : `Volume set to ${vol}%.`;
  },
});

system.registerTool("notify", {
  description: "Show a system notification",
  parameters: { title: "string", message: "string" },
  keywords: ["notify", "notification", "alert", "remind"],
  examples: [
    { input: "remind me to take a break", arguments: { title: "Reminder", message: "Take a break!" } },
  ],
  handler: ({ title, message }) => {
    if (isMac) {
      execSync(`osascript -e 'display notification "${message}" with title "${title}"'`);
      return `Notification: ${title} — ${message}`;
    }
    return `[${title}] ${message}`;
  },
});

system.registerTool("getTime", {
  description: "Get the current date and time",
  parameters: {},
  keywords: ["time", "date", "clock", "today"],
  examples: [{ input: "what time is it", arguments: {} }],
  handler: () => {
    const now = new Date();
    return `${now.toLocaleTimeString()} on ${now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}.`;
  },
});

system.registerTool("chat", {
  description: "Respond conversationally when no other tool matches",
  parameters: { message: "string" },
  examples: [
    { input: "hello", arguments: { message: "Hello! I can open apps, run commands, get system info, and more." } },
    { input: "two plus two", arguments: { message: "Four." } },
  ],
  handler: ({ message }) => message,
});

// --- Events ---

system.on("loading", (l) => {
  if (l.status === "loading") process.stdout.write(`${c.yellow}⟳ Loading ${l.module}...${c.reset}\n`);
  if (l.status === "ready") process.stdout.write(`${c.green}✓ ${l.module} ready${c.reset}\n`);
  if (l.status === "error") process.stdout.write(`${c.red}✗ ${l.module} failed${c.reset}\n`);
});

system.on("intent", (i) => {
  const calls = Array.isArray(i) ? i : [i];
  for (const call of calls) {
    console.log(`${c.magenta}→ ${call.tool}${c.dim}(${JSON.stringify(call.arguments)})${c.reset}`);
  }
});

system.on("executed", (results) => {
  for (const r of results) {
    if (r.error) console.log(`${c.red}✗ ${r.error}${c.reset}`);
    else if (typeof r.result === "string") console.log(`${c.green}${r.result}${c.reset}`);
  }
});

system.on("error", (e) => console.log(`${c.red}Error: ${e.error}${c.reset}`));

// --- Voice recording ---

let isRecording = false;

async function handleVoice(): Promise<string | null> {
  isRecording = true;
  try {
    // Load Whisper on first voice use (avoids ONNX conflict during LLM init)
    await ensureWhisper();
    console.log(`${c.cyan}🎤 Recording... press Enter to stop${c.reset}`);
    const wavPath = await recordUntilEnter();
    console.log(`${c.yellow}⟳ Transcribing...${c.reset}`);
    const transcript = await transcribeFile(wavPath);
    if (transcript.text) {
      console.log(`${c.blue}📝 "${transcript.text}"${c.reset}`);
      return transcript.text;
    }
    console.log(`${c.dim}(no speech detected)${c.reset}`);
    return null;
  } catch (err) {
    console.log(`${c.red}Recording error: ${err}${c.reset}`);
    return null;
  } finally {
    isRecording = false;
  }
}

// --- Main ---

let whisperReady = false;

async function ensureWhisper() {
  if (whisperReady) return;
  console.log(`${c.yellow}⟳ Loading Whisper STT (first run downloads ~75MB model)...${c.reset}`);
  await warmUpWhisper();
  whisperReady = true;
  console.log(`${c.green}✓ Whisper STT ready${c.reset}`);
}

async function pickAudioDevice() {
  const devices = await listAudioDevices();
  if (devices.length === 0) {
    console.log(`${c.dim}No audio devices found. Voice mode will use system default.${c.reset}`);
    return;
  }
  console.log(`\n${c.bold}Audio input devices:${c.reset}`);
  devices.forEach((d) => console.log(`  ${c.cyan}${d.index}${c.reset} — ${d.name}`));

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const choice = await new Promise<string>((resolve) => {
    rl.question(`${c.blue}Pick device number [default: system default]: ${c.reset}`, resolve);
  });
  rl.close();

  const num = parseInt(choice.trim());
  if (!isNaN(num)) {
    setAudioDevice(num);
    const name = devices.find((d) => d.index === num)?.name ?? `device ${num}`;
    console.log(`${c.green}✓ Using: ${name}${c.reset}`);
  } else {
    console.log(`${c.dim}Using system default.${c.reset}`);
  }
}

async function main() {
  // Pick audio device first
  await pickAudioDevice();

  console.log(`\n${c.yellow}⟳ Loading LLM (first run downloads ~400MB model)...${c.reset}\n`);

  // Load LLM first — Whisper loads lazily on first voice use
  await system.start();

  console.log(`\n${c.bold}Ready!${c.reset}`);
  console.log(`${c.dim}  Press Enter alone → voice mode (speak, then Enter to stop)`);
  console.log(`  Type text + Enter → text mode`);
  console.log(`  'quit' → exit${c.reset}\n`);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const prompt = () => {
    rl.question(`${c.blue}> ${c.reset}`, async (input) => {
      const trimmed = input.trim();

      if (trimmed === "quit" || trimmed === "exit") {
        console.log(`\n${c.dim}Goodbye!${c.reset}`);
        await system.destroy();
        rl.close();
        process.exit(0);
      }

      if (!trimmed) {
        // Empty input = voice mode
        rl.pause();
        const text = await handleVoice();
        rl.resume();
        if (text) {
          try { await system.processText(text); } catch {}
        }
      } else {
        // Text mode
        try { await system.processText(trimmed); } catch {}
      }

      console.log("");
      prompt();
    });
  };

  prompt();
}

main();
