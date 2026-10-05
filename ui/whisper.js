// Spracheingabe: Whisper läuft komplett auf dem Gerät (transformers.js + ONNX/WebAssembly).
// Die Aufnahme verlässt das Gerät nie. Nur das Modell wird beim ersten Mal einmalig geladen
// (von Hugging Face) und danach im Browser-Speicher des Geräts behalten.
import { pipeline, env } from "@huggingface/transformers";

env.allowLocalModels = false;
env.useBrowserCache = true;
// WebAssembly-Dateien liegen in der App selbst, nicht auf einem fremden Server
env.backends.onnx.wasm.wasmPaths = new URL("./ort/", import.meta.url).href;
env.backends.onnx.wasm.numThreads = 1;

export const MODEL = "onnx-community/whisper-base";
let asr = null, loading = null;

export function isReady() { return !!asr; }

export async function load(onProgress) {
  if (asr) return asr;
  if (!loading) {
    const files = {};
    loading = pipeline("automatic-speech-recognition", MODEL, {
      dtype: { encoder_model: "q8", decoder_model_merged: "q8" }, // zusammen ca. 77 MB
      device: "wasm",
      progress_callback: p => {
        if (p.status === "progress" && p.file) files[p.file] = { l: p.loaded || 0, t: p.total || 0 };
        if (onProgress) {
          let l = 0, t = 0; Object.values(files).forEach(f => { l += f.l; t += f.t; });
          onProgress(t ? l / t : 0, t);
        }
      },
    }).then(p => (asr = p)).catch(e => { loading = null; throw e; });
  }
  return loading;
}

// Audio (Blob aus dem Mikrofon) → 16 kHz Mono → Text
export async function transcribe(blob) {
  const p = await load();
  const buf = await blob.arrayBuffer();
  const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
  let audio;
  try {
    const dec = await ctx.decodeAudioData(buf);
    audio = dec.numberOfChannels > 1 ? mix(dec) : dec.getChannelData(0);
  } finally { ctx.close(); }
  const out = await p(audio, { language: "german", task: "transcribe", chunk_length_s: 30 });
  return (out && out.text ? out.text : "").trim();
}

function mix(dec) {
  const a = dec.getChannelData(0), b = dec.getChannelData(1), m = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) m[i] = (a[i] + b[i]) / 2;
  return m;
}
