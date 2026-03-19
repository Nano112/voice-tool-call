/**
 * Local Whisper STT for Node/Bun environments.
 * Uses @huggingface/transformers (already installed via kokoro-js).
 * Records audio via ffmpeg, transcribes locally with Whisper.
 */

import type { Transcript } from "../types";
import { spawn } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import { unlinkSync, existsSync } from "fs";

export type WhisperConfig = {
  model?: string; // default: "onnx-community/whisper-tiny.en"
  dtype?: string;
  /** Audio input device index for ffmpeg (macOS avfoundation). Use listAudioDevices() to find. */
  audioDevice?: number;
};

let pipeline: any = null;
let loadingPromise: Promise<any> | null = null;

async function getTranscriber(config: WhisperConfig) {
  if (pipeline) return pipeline;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const { pipeline: createPipeline } = await import("@huggingface/transformers");
    pipeline = await createPipeline(
      "automatic-speech-recognition",
      config.model ?? "onnx-community/whisper-tiny.en",
      { dtype: (config.dtype ?? "q4") as any }
    );
    return pipeline;
  })();

  pipeline = await loadingPromise;
  loadingPromise = null;
  return pipeline;
}

/** Stored audio device preference */
let preferredDevice: number | undefined;

export function setAudioDevice(deviceIndex: number): void {
  preferredDevice = deviceIndex;
}

/**
 * List available audio input devices (macOS only).
 */
export async function listAudioDevices(): Promise<{ index: number; name: string }[]> {
  const { spawnSync } = await import("child_process");
  try {
    const result = spawnSync("ffmpeg", ["-f", "avfoundation", "-list_devices", "true", "-i", ""], {
      encoding: "utf-8",
      timeout: 5000,
    });
    // ffmpeg outputs device list to stderr
    const output = (result.stderr ?? "") + (result.stdout ?? "");
    const devices: { index: number; name: string }[] = [];
    let inAudio = false;
    for (const line of output.split("\n")) {
      if (line.includes("audio devices")) { inAudio = true; continue; }
      if (inAudio) {
        // Match [N] device name — the line has an AVFoundation prefix like [AVFoundation indev @ 0x...] [N] Name
        const match = line.match(/\]\s+\[(\d+)\]\s+(.+)/);
        if (match) devices.push({ index: parseInt(match[1]), name: match[2].trim() });
      }
    }
    return devices;
  } catch {
    return [];
  }
}

function getAudioInput(config?: WhisperConfig): string {
  const device = config?.audioDevice ?? preferredDevice;
  if (process.platform === "darwin") {
    return `:${device ?? "default"}`;
  }
  return "default";
}

function getAudioFormat(): string {
  return process.platform === "darwin" ? "avfoundation" : "pulse";
}

/**
 * Record audio from the microphone using ffmpeg.
 * Returns the path to a temp WAV file.
 */
function recordAudio(durationSeconds: number = 5, config?: WhisperConfig): Promise<string> {
  const tempFile = join(tmpdir(), `vtc-recording-${Date.now()}.wav`);

  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-f", getAudioFormat(),
      "-i", getAudioInput(config),
      "-t", String(durationSeconds),
      "-ar", "16000",
      "-ac", "1",
      "-y",
      tempFile,
    ], { stdio: ["pipe", "pipe", "pipe"] });

    proc.on("close", (code) => {
      if (code === 0 && existsSync(tempFile)) {
        resolve(tempFile);
      } else {
        reject(new Error(`ffmpeg recording failed with code ${code}`));
      }
    });

    proc.on("error", reject);
  });
}

/**
 * Record audio using native macOS Swift recorder (reliable mic access)
 * or ffmpeg as fallback.
 */
export function recordUntilEnter(config?: WhisperConfig): Promise<string> {
  const tempFile = join(tmpdir(), `vtc-recording-${Date.now()}.wav`);

  // Try native Swift recorder first on macOS
  if (process.platform === "darwin") {
    return recordWithSwift(tempFile);
  }

  return recordWithFfmpeg(tempFile, config);
}

function recordWithSwift(tempFile: string): Promise<string> {
  const { resolve: resolvePath } = require("path") as typeof import("path");

  // Look for compiled record binary
  const candidates = [
    resolvePath(__dirname, "../../examples/node/record"),
    resolvePath(process.cwd(), "examples/node/record"),
    resolvePath(process.cwd(), "record"),
  ];

  let binaryPath = "";
  for (const p of candidates) {
    if (existsSync(p)) { binaryPath = p; break; }
  }

  if (!binaryPath) {
    return recordWithFfmpeg(tempFile);
  }

  return new Promise((resolve, reject) => {
    const proc = spawn(binaryPath, [tempFile], {
      stdio: ["pipe", "pipe", "pipe"],
    });

    proc.stdout?.on("data", () => {});
    proc.stderr?.on("data", () => {});

    // Listen for Enter to stop recording
    const onData = () => {
      proc.stdin?.write("\n");
      proc.stdin?.end();
      process.stdin.removeListener("data", onData);
      process.stdin.setRawMode?.(false);
    };

    // Small delay to let Swift start, then capture Enter
    setTimeout(() => {
      process.stdin.setRawMode?.(true);
      process.stdin.resume();
      process.stdin.once("data", onData);
    }, 500);

    proc.on("close", () => {
      if (existsSync(tempFile)) {
        resolve(tempFile);
      } else {
        reject(new Error("Native recording failed"));
      }
    });

    proc.on("error", () => {
      recordWithFfmpeg(tempFile).then(resolve).catch(reject);
    });
  });
}

function recordWithFfmpeg(tempFile: string, config?: WhisperConfig): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", [
      "-f", getAudioFormat(),
      "-i", getAudioInput(config),
      "-ar", "16000",
      "-ac", "1",
      "-y",
      tempFile,
    ], { stdio: ["pipe", "pipe", "pipe"] });

    let lastLevel = "";
    proc.stderr?.on("data", (data: Buffer) => {
      const str = data.toString();
      const timeMatch = str.match(/time=(\d+:\d+:\d+\.\d+)/);
      if (timeMatch && timeMatch[1] !== lastLevel) {
        lastLevel = timeMatch[1];
        process.stdout.write(`\r  ⏺ Recording: ${lastLevel} `);
      }
    });

    const onData = () => {
      proc.kill("SIGINT");
      process.stdin.removeListener("data", onData);
      process.stdin.setRawMode?.(false);
      process.stdout.write("\r" + " ".repeat(40) + "\r");
    };

    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.once("data", onData);

    proc.on("close", () => {
      if (existsSync(tempFile)) {
        resolve(tempFile);
      } else {
        reject(new Error("Recording failed"));
      }
    });

    proc.on("error", reject);
  });
}

/**
 * Read a 16-bit PCM WAV file and return Float32Array audio data.
 */
function readWavAsFloat32(filePath: string): { audio: Float32Array; sampleRate: number } {
  const { readFileSync } = require("fs") as typeof import("fs");
  const buffer = readFileSync(filePath);

  // Parse WAV header
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);

  // Find data chunk
  let dataOffset = 44; // standard WAV header size
  for (let i = 36; i < buffer.length - 8; i++) {
    if (buffer[i] === 0x64 && buffer[i+1] === 0x61 && buffer[i+2] === 0x74 && buffer[i+3] === 0x61) {
      dataOffset = i + 8;
      break;
    }
  }

  const bytesPerSample = bitsPerSample / 8;
  const numSamples = (buffer.length - dataOffset) / bytesPerSample;
  const audio = new Float32Array(numSamples);

  for (let i = 0; i < numSamples; i++) {
    const offset = dataOffset + i * bytesPerSample;
    if (bitsPerSample === 16) {
      audio[i] = view.getInt16(offset, true) / 32768;
    } else if (bitsPerSample === 32) {
      audio[i] = view.getFloat32(offset, true);
    }
  }

  return { audio, sampleRate };
}

/**
 * Transcribe a WAV file using Whisper.
 * Reads the raw PCM data and passes it directly (no AudioContext needed).
 */
export async function transcribeFile(
  filePath: string,
  config: WhisperConfig = {}
): Promise<Transcript> {
  const transcriber = await getTranscriber(config);
  const { audio, sampleRate } = readWavAsFloat32(filePath);

  // Pass raw audio data + sampling rate to the pipeline
  const result = await transcriber(audio, { sampling_rate: sampleRate });

  // Clean up temp file
  try { unlinkSync(filePath); } catch {}

  return {
    text: (result as any).text?.trim() ?? "",
    confidence: 0.9,
  };
}

/**
 * Record from mic for a fixed duration and transcribe.
 */
export async function listenAndTranscribe(
  durationSeconds: number = 5,
  config: WhisperConfig = {}
): Promise<Transcript> {
  const filePath = await recordAudio(durationSeconds);
  return transcribeFile(filePath, config);
}

/**
 * Pre-load the Whisper model.
 */
export async function warmUpWhisper(config: WhisperConfig = {}): Promise<void> {
  await getTranscriber(config);
}
