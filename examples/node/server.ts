#!/usr/bin/env bun
/**
 * Server-side voice tool calling demo with continuous audio streaming.
 */

// Polyfill DecompressionStream for Bun (needed by kokoro-js phonemizer)
if (typeof globalThis.DecompressionStream === "undefined") {
  const zlib = require("zlib");
  (globalThis as any).DecompressionStream = class DecompressionStream {
    readable: ReadableStream;
    writable: WritableStream;
    constructor(format: string) {
      const decompressor = format === "gzip" ? zlib.createGunzip() : format === "deflate" ? zlib.createInflate() : zlib.createInflateRaw();
      this.readable = new ReadableStream({
        start(controller) {
          decompressor.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
          decompressor.on("end", () => controller.close());
          decompressor.on("error", (err: Error) => controller.error(err));
        },
      });
      this.writable = new WritableStream({
        write(chunk) { decompressor.write(chunk); },
        close() { decompressor.end(); },
      });
    }
  };
}

/**
 *
 * Browser = continuous mic stream via WebSocket (no processing).
 * Server = VAD (voice activity detection) + Whisper STT + wake word + LLM + tools.
 *
 * Run: bun examples/node/server.ts
 */

import { VoiceToolSystem } from "../../src/lib/node";
import { warmUpWhisper, transcribeFile } from "../../src/lib/node";
import { KokoroTTSEngine } from "../../src/lib/tts/KokoroTTS";
import { tmpdir } from "os";
import { join } from "path";
import { writeFileSync, unlinkSync, existsSync } from "fs";
import { execSync } from "child_process";

// --- System ---

const system = new VoiceToolSystem({
  intent: "llama-cpp",
  autoSpeak: false,
  autoDetect: false,
  llamaCpp: { gpuLayers: -1 },
});

const WAKE_WORDS = ["hey assistant", "hey computer"];
const SILENCE_THRESHOLD_MS = 1500; // How long silence before processing a chunk
const MIN_AUDIO_MS = 500; // Minimum audio duration to bother transcribing

// --- Tools ---

const state = {
  queue: [] as { title: string }[],
  playing: null as { title: string } | null,
  paused: false,
  volume: 50,
};

system.registerTool("play", {
  description: "Play a video or song by title or URL",
  parameters: { query: "string" },
  keywords: ["play", "put on", "queue"],
  examples: [
    { input: "play never gonna give you up", arguments: { query: "never gonna give you up" } },
    { input: "put on some lofi", arguments: { query: "lofi beats" } },
  ],
  handler: ({ query }) => {
    if (state.playing) { state.queue.push({ title: query }); return "Added \"" + query + "\" to queue."; }
    state.playing = { title: query }; state.paused = false;
    return "Now playing: \"" + query + "\".";
  },
});

system.registerTool("skip", {
  description: "Skip current track", parameters: {}, keywords: ["skip", "next"],
  examples: [{ input: "skip", arguments: {} }, { input: "next song", arguments: {} }],
  handler: () => {
    if (!state.playing) return "Nothing playing.";
    const s = state.playing.title;
    state.playing = state.queue.shift() ?? null;
    return "Skipped \"" + s + "\"." + (state.playing ? " Now: \"" + state.playing.title + "\"." : "");
  },
});

system.registerTool("stop", {
  description: "Stop playback and clear queue", parameters: {}, keywords: ["stop", "clear"],
  examples: [{ input: "stop the music", arguments: {} }],
  handler: () => { state.playing = null; state.queue = []; return "Stopped."; },
});

system.registerTool("getQueue", {
  description: "Show what's playing and the queue", parameters: {},
  keywords: ["queue", "playing", "status", "what's on"],
  examples: [{ input: "what's playing", arguments: {} }, { input: "show the queue", arguments: {} }],
  handler: () => {
    let msg = state.playing ? "Playing: \"" + state.playing.title + "\"" : "Nothing playing.";
    if (state.queue.length) msg += " Queue: " + state.queue.map((q, i) => (i + 1) + ". " + q.title).join(", ");
    return msg;
  },
});

system.registerTool("setVolume", {
  description: "Set volume (0-100)", parameters: { level: "number" },
  keywords: ["volume", "louder", "quieter", "mute"],
  examples: [{ input: "volume 50", arguments: { level: 50 } }, { input: "mute", arguments: { level: 0 } }],
  handler: ({ level }) => { state.volume = Math.max(0, Math.min(100, level ?? 50)); return state.volume === 0 ? "Muted." : "Volume: " + state.volume + "%."; },
});

system.registerTool("notify", {
  description: "Show a system notification", parameters: { title: "string", message: "string" },
  keywords: ["notify", "notification", "remind"],
  examples: [{ input: "send a test notification", arguments: { title: "Test", message: "Hello!" } }],
  handler: ({ title, message }) => {
    try { execSync("osascript -e 'display notification \"" + message + "\" with title \"" + title + "\"'"); } catch {}
    return "Notification: " + title + " — " + message;
  },
});

system.registerTool("getTime", {
  description: "Get current time", parameters: {},
  keywords: ["time", "date", "clock"],
  examples: [{ input: "what time is it", arguments: {} }],
  handler: () => new Date().toLocaleTimeString() + " on " + new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }),
});

system.registerTool("chat", {
  description: "Respond conversationally when no other tool matches",
  parameters: { message: "string" },
  examples: [
    { input: "hello", arguments: { message: "Hey! I can play music, control volume, send notifications, and more." } },
    { input: "two plus two", arguments: { message: "Four." } },
  ],
  handler: ({ message }) => message,
});

// --- Kokoro TTS (server-side) ---
const kokoro = new KokoroTTSEngine({ voice: "af_heart", device: "cpu" as any, dtype: "q4" as any });

async function generateSpeech(text: string): Promise<string | null> {
  try {
    await kokoro.load();
    const audio = await (kokoro as any).model!.generate(text, { voice: "af_heart" });
    // Convert Float32 audio to 16-bit WAV, then base64
    const pcm = new Int16Array(audio.audio.length);
    for (let i = 0; i < audio.audio.length; i++) {
      pcm[i] = Math.max(-32768, Math.min(32767, Math.round(audio.audio[i] * 32767)));
    }
    const wav = pcmToWav(pcm, audio.sampling_rate);
    return Buffer.from(wav).toString("base64");
  } catch (err) {
    console.error("Kokoro TTS error:", err);
    return null;
  }
}

system.on("loading", (l) => console.log("[" + l.status + "] " + l.module));
system.on("intent:mode", (m) => console.log("[intent] " + m.mode));
system.on("error", (e) => console.error("[error] " + (e.source ?? "") + ": " + e.error));

// --- Audio processing ---

async function transcribeAudio(audioData: Buffer): Promise<string> {
  const tempIn = join(tmpdir(), "vtc-" + Date.now() + ".webm");
  const tempWav = join(tmpdir(), "vtc-" + Date.now() + ".wav");
  writeFileSync(tempIn, audioData);

  try {
    execSync("ffmpeg -i \"" + tempIn + "\" -ar 16000 -ac 1 -y \"" + tempWav + "\" 2>/dev/null");
  } catch {
    try { unlinkSync(tempIn); } catch {}
    return "";
  }
  try { unlinkSync(tempIn); } catch {}

  if (!existsSync(tempWav)) return "";
  const transcript = await transcribeFile(tempWav);
  return transcript.text;
}

function matchesWakeWord(text: string): { matched: boolean; remainder: string } {
  const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  for (const wake of WAKE_WORDS) {
    const idx = normalized.indexOf(wake);
    if (idx !== -1) {
      return { matched: true, remainder: normalized.slice(idx + wake.length).trim() };
    }
  }
  return { matched: false, remainder: "" };
}

// Per-client audio session
class AudioSession {
  private chunks: Buffer[] = [];
  private lastChunkTime = 0;
  private silenceTimer: ReturnType<typeof setTimeout> | null = null;
  private activated = false; // wake word heard, waiting for command
  private processing = false;
  private send: (msg: any) => void;

  constructor(send: (msg: any) => void) {
    this.send = send;
  }

  addChunk(data: Buffer) {
    this.chunks.push(data);
    this.lastChunkTime = Date.now();

    // Reset silence timer
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
    this.silenceTimer = setTimeout(() => this.onSilence(), SILENCE_THRESHOLD_MS);
  }

  private async onSilence() {
    if (this.processing || this.chunks.length === 0) return;
    this.processing = true;

    const audioBuffer = Buffer.concat(this.chunks);
    this.chunks = [];

    // Skip very short audio
    if (audioBuffer.length < 1000) {
      this.processing = false;
      return;
    }

    try {
      const text = await transcribeAudio(audioBuffer);
      if (!text || text.length < 2) {
        this.processing = false;
        return;
      }

      console.log("Heard: \"" + text + "\"");
      this.send({ type: "transcript", text });

      if (this.activated) {
        // We already heard the wake word — this is the command
        console.log("  Command: \"" + text + "\"");
        this.activated = false;
        this.send({ type: "status", text: "Processing command..." });
        await this.executeCommand(text);
      } else {
        // Check for wake word
        const { matched, remainder } = matchesWakeWord(text);
        if (matched) {
          if (remainder) {
            // Wake word + command in one utterance
            console.log("  Wake + command: \"" + remainder + "\"");
            this.send({ type: "wakeword", activated: true });
            this.send({ type: "status", text: "Processing: " + remainder });
            await this.executeCommand(remainder);
          } else {
            // Just wake word, wait for command
            console.log("  Wake word detected! Listening for command...");
            this.activated = true;
            this.send({ type: "wakeword", activated: true });
            this.send({ type: "status", text: "Listening for command..." });
          }
        }
        // No wake word — ignore (ambient speech)
      }
    } catch (err) {
      console.error("Processing error:", err);
      this.send({ type: "error", error: String(err) });
    }

    this.processing = false;
  }

  private async executeCommand(text: string) {
    try {
      const results = await system.processText(text);
      for (const r of results) {
        console.log("  => " + r.tool + ": " + (r.error ?? r.result));
      }
      this.send({
        type: "result",
        results: results.map(r => ({ tool: r.tool, arguments: r.arguments, result: r.result, error: r.error })),
      });
    } catch (err) {
      this.send({ type: "error", error: String(err) });
    }
  }

  handleText(text: string) {
    // Text input bypasses wake word
    console.log("> \"" + text + "\"");
    this.executeCommand(text);
  }

  destroy() {
    if (this.silenceTimer) clearTimeout(this.silenceTimer);
  }
}

// --- HTML ---

const HTML = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Voice Tool Call</title>
<style>
*{margin:0;box-sizing:border-box}
body{font-family:system-ui;background:#0f0f1a;color:#e2e8f0;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:40px 20px;gap:16px}
h1{font-size:22px} .sub{color:#64748b;font-size:13px}
#log{background:#1e1e2e;border-radius:8px;padding:16px;font-family:monospace;font-size:13px;width:100%;max-width:600px;max-height:400px;overflow-y:auto}
.e{margin-bottom:5px;white-space:pre-wrap} .t{color:#475569;margin-right:6px}
button{padding:12px 28px;font-size:15px;border-radius:50px;border:none;color:#fff;cursor:pointer}
.row{display:flex;gap:8px;width:100%;max-width:600px}
input{flex:1;padding:10px 14px;border-radius:8px;border:1px solid #3d3d4f;background:#1e1e2e;color:#e2e8f0;font-size:14px;outline:none}
#status{font-size:13px;padding:8px 16px;border-radius:20px;background:#1e1e2e}
#mic-indicator{width:12px;height:12px;border-radius:50%;display:inline-block;margin-right:6px}
</style></head><body>
<h1>Voice Tool Call — Server Demo</h1>
<p class="sub">Continuous mic stream to server. Say <b style="color:#a78bfa">"Hey Assistant"</b> + command.</p>
<p class="sub">All processing: Whisper STT + LLM + tools on the server.</p>
<div id="status"><span id="mic-indicator" style="background:#f59e0b"></span>Connecting...</div>
<div class="row">
  <input id="input" placeholder="Or type a command...">
  <button onclick="sendText()" style="background:#8b5cf6;padding:10px 20px;font-size:14px;border-radius:8px">Send</button>
</div>
<div id="log"></div>
<script>
const log=document.getElementById('log'),inp=document.getElementById('input'),st=document.getElementById('status'),ind=document.getElementById('mic-indicator');
const colors={transcript:'#60a5fa',intent:'#a78bfa',result:'#34d399',error:'#f87171',info:'#94a3b8',wakeword:'#22c55e',status:'#f59e0b'};

function addLog(t,m){const d=document.createElement('div');d.className='e';d.innerHTML='<span class="t">['+t+']</span><span style="color:'+(colors[t]||'#94a3b8')+'">'+m+'</span>';log.appendChild(d);log.scrollTop=log.scrollHeight;}
function setStatus(text,color){st.innerHTML='<span id="mic-indicator" style="background:'+color+';width:12px;height:12px;border-radius:50%;display:inline-block;margin-right:6px"></span>'+text;}
// Play WAV audio from server
let audioCtx=null;
function playWav(base64){
  const bytes=atob(base64);
  const buf=new Uint8Array(bytes.length);
  for(let i=0;i<bytes.length;i++)buf[i]=bytes.charCodeAt(i);
  if(!audioCtx)audioCtx=new AudioContext();
  audioCtx.decodeAudioData(buf.buffer).then(ab=>{
    const src=audioCtx.createBufferSource();
    src.buffer=ab;src.connect(audioCtx.destination);src.start();
  });
}
function speak(t){/* server sends audio via ws */}

const ws=new WebSocket('ws://'+location.host+'/ws');
ws.binaryType='arraybuffer';

ws.onopen=async()=>{
  setStatus('Streaming mic to server...','#22c55e');
  addLog('info','Connected. Mic streaming. Say "Hey Assistant" + a command.');

  // Start continuous mic capture
  const stream=await navigator.mediaDevices.getUserMedia({audio:{sampleRate:16000,channelCount:1,echoCancellation:true,noiseSuppression:true}});
  const ctx=new AudioContext({sampleRate:16000});
  const source=ctx.createMediaStreamSource(stream);
  const processor=ctx.createScriptProcessor(4096,1,1);

  processor.onaudioprocess=(e)=>{
    const data=e.inputBuffer.getChannelData(0);
    // Send as 16-bit PCM
    const pcm=new Int16Array(data.length);
    for(let i=0;i<data.length;i++) pcm[i]=Math.max(-1,Math.min(1,data[i]))*32767;
    if(ws.readyState===1) ws.send(pcm.buffer);
  };

  source.connect(processor);
  processor.connect(ctx.destination);
};

ws.onmessage=(e)=>{
  const msg=JSON.parse(e.data);
  if(msg.type==='transcript'){addLog('transcript','"'+msg.text+'"');}
  if(msg.type==='wakeword'){setStatus(msg.activated?'Wake word! Listening for command...':'Listening...','#22c55e');addLog('wakeword','Activated!');}
  if(msg.type==='status'){addLog('status',msg.text);}
  if(msg.type==='result'){
    setStatus('Streaming mic to server...','#22c55e');
    for(const r of msg.results||[]){
      addLog('intent',r.tool+'('+JSON.stringify(r.arguments)+')');
      if(r.error) addLog('error',r.error);
      else if(r.result){addLog('result',r.result);}
    }
  }
  if(msg.type==='audio'){playWav(msg.data);}
  if(msg.type==='vad'){setStatus(msg.speaking?'Speaking...':'Listening...', msg.speaking?'#ef4444':'#22c55e');}
  if(msg.type==='error'){addLog('error',msg.error);setStatus('Listening...','#22c55e');}
};
ws.onclose=()=>setStatus('Disconnected','#ef4444');

function sendText(){const t=inp.value.trim();if(t&&ws.readyState===1){ws.send(JSON.stringify({type:'text',text:t}));addLog('transcript','"'+t+'"');inp.value='';}}
inp.addEventListener('keydown',e=>{if(e.key==='Enter')sendText();});
</script></body></html>`;

// --- Server ---

async function main() {
  console.log("Loading LLM + Whisper + Kokoro...\n");
  await system.start();
  console.log("LLM ready.");
  await warmUpWhisper();
  console.log("Whisper ready.");
  await kokoro.load();
  console.log("Kokoro TTS ready.\n");

  // Per-client VAD state
  const PRE_ROLL = 3; // Keep last N silent chunks as pre-roll (captures "Hey" before energy spikes)

  type ClientState = {
    speaking: boolean;
    activated: boolean;
    speechChunks: Int16Array[];
    preRoll: Int16Array[]; // rolling buffer of recent silent chunks
    silenceCount: number;
    processing: boolean;
  };
  const clients = new Map<any, ClientState>();

  const ENERGY_THRESHOLD = 500;
  const SILENCE_CHUNKS = 6;

  function getRMS(pcm: Int16Array): number {
    let sum = 0;
    for (let i = 0; i < pcm.length; i++) sum += pcm[i] * pcm[i];
    return Math.sqrt(sum / pcm.length);
  }

  function send(ws: any, msg: any) {
    try { ws.send(JSON.stringify(msg)); } catch {}
  }

  async function sendResultsWithAudio(ws: any, results: any[]) {
    const mapped = results.map(r => ({ tool: r.tool, arguments: r.arguments, result: r.result, error: r.error }));
    send(ws, { type: "result", results: mapped });
    // Generate Kokoro audio for string results
    for (const r of results) {
      if (typeof r.result === "string" && r.result && !r.error) {
        const audio = await generateSpeech(r.result);
        if (audio) send(ws, { type: "audio", data: audio });
      }
    }
  }

  async function processUtterance(ws: any, client: ClientState) {
    if (client.processing || client.speechChunks.length === 0) return;
    client.processing = true;

    const totalLen = client.speechChunks.reduce((s, c) => s + c.length, 0);
    const combined = new Int16Array(totalLen);
    let off = 0;
    for (const c of client.speechChunks) { combined.set(c, off); off += c.length; }
    client.speechChunks = [];

    if (totalLen < 8000) { client.processing = false; return; } // < 0.5s

    const tempWav = join(tmpdir(), "vtc-" + Date.now() + ".wav");
    writeFileSync(tempWav, pcmToWav(combined, 16000));

    try {
      const transcript = await transcribeFile(tempWav);
      const text = transcript.text?.trim();
      if (!text || text.length < 2) { client.processing = false; return; }

      console.log("Heard: \"" + text + "\"");
      send(ws, { type: "transcript", text });

      if (client.activated) {
        // Wake word was already heard — this is the command
        client.activated = false;
        console.log("  Command: \"" + text + "\"");
        send(ws, { type: "status", text: "Processing..." });
        const results = await system.processText(text);
        for (const r of results) console.log("  => " + r.tool + ": " + (r.error ?? r.result));
        await sendResultsWithAudio(ws, results);
      } else {
        const { matched, remainder } = matchesWakeWord(text);
        if (matched && remainder) {
          console.log("  Wake + cmd: \"" + remainder + "\"");
          send(ws, { type: "wakeword", activated: true });
          const results = await system.processText(remainder);
          for (const r of results) console.log("  => " + r.tool + ": " + (r.error ?? r.result));
          await sendResultsWithAudio(ws, results);
        } else if (matched) {
          console.log("  Wake word! Listening...");
          client.activated = true;
          send(ws, { type: "wakeword", activated: true });
          send(ws, { type: "status", text: "Listening for command..." });
        }
        // else: ambient speech, ignore
      }
    } catch (err) {
      console.error("Transcription error:", err);
    }

    client.processing = false;
  }

  const server = Bun.serve({
    port: 3456,
    fetch(req, server) {
      const url = new URL(req.url);
      if (url.pathname === "/ws") {
        if (server.upgrade(req)) return;
        return new Response("Upgrade failed", { status: 500 });
      }
      return new Response(HTML, { headers: { "Content-Type": "text/html" } });
    },
    websocket: {
      open(ws) {
        clients.set(ws, { speaking: false, activated: false, speechChunks: [], preRoll: [], silenceCount: 0, processing: false });
        console.log("Client connected.");
      },
      async message(ws, message) {
        const client = clients.get(ws);
        if (!client) return;

        if (typeof message === "string") {
          const data = JSON.parse(message);
          if (data.type === "text") {
            console.log("> \"" + data.text + "\"");
            try {
              const results = await system.processText(data.text);
              for (const r of results) console.log("  => " + r.tool + ": " + (r.error ?? r.result));
              await sendResultsWithAudio(ws, results);
            } catch (err) { send(ws, { type: "error", error: String(err) }); }
          }
        } else {
          // Binary PCM — voice activity detection
          const pcm = new Int16Array(message instanceof ArrayBuffer ? message : (message as Buffer).buffer);
          const rms = getRMS(pcm);
          const isSpeech = rms > ENERGY_THRESHOLD;

          if (isSpeech) {
            if (!client.speaking) {
              client.speaking = true;
              send(ws, { type: "vad", speaking: true });
              // Prepend pre-roll buffer so we capture "Hey" before the energy spike
              client.speechChunks.push(...client.preRoll);
              client.preRoll = [];
            }
            client.speechChunks.push(pcm);
            client.silenceCount = 0;
          } else {
            if (client.speaking) {
              client.silenceCount++;
              client.speechChunks.push(pcm);

              if (client.silenceCount >= SILENCE_CHUNKS) {
                client.speaking = false;
                send(ws, { type: "vad", speaking: false });
                processUtterance(ws, client);
              }
            } else {
              // Not speaking — maintain rolling pre-roll buffer
              client.preRoll.push(pcm);
              if (client.preRoll.length > PRE_ROLL) client.preRoll.shift();
            }
          }
        }
      },
      close(ws) {
        clients.delete(ws);
        console.log("Client disconnected.");
      },
    },
  });

  console.log("\nServer: http://localhost:" + server.port);
  try { execSync("open http://localhost:" + server.port); } catch {}

  // REPL
  const readline = await import("readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const prompt = () => {
    rl.question("> ", async (input) => {
      const t = input.trim();
      if (!t) { prompt(); return; }
      if (t === "quit") process.exit(0);
      try {
        const results = await system.processText(t);
        for (const r of results) console.log("  => " + r.tool + ": " + (r.error ?? r.result));
      } catch {}
      prompt();
    });
  };
  prompt();
}

// Convert Int16Array PCM to WAV buffer
function pcmToWav(pcm: Int16Array, sampleRate: number): Buffer {
  const dataSize = pcm.length * 2;
  const buffer = Buffer.alloc(44 + dataSize);

  // RIFF header
  buffer.write("RIFF", 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8);

  // fmt chunk
  buffer.write("fmt ", 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buffer.writeUInt16LE(2, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample

  // data chunk
  buffer.write("data", 36);
  buffer.writeUInt32LE(dataSize, 40);

  // PCM data
  for (let i = 0; i < pcm.length; i++) {
    buffer.writeInt16LE(pcm[i], 44 + i * 2);
  }

  return buffer;
}

main();
