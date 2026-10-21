import { Worker } from "node:worker_threads";
import { fileURLToPath } from "node:url";

export const defaultModelDir = fileURLToPath(new URL("../models/paraformer-streaming/", import.meta.url));

export class FastAsr {
  constructor({ modelDir = process.env.PARAFORMER_MODEL_DIR || defaultModelDir } = {}) {
    this.modelDir = modelDir;
    this.pending = new Map();
    this.sequence = 0;
  }

  async start() {
    if (this.ready) return this.ready;
    this.worker = new Worker(new URL("./asr-worker.js", import.meta.url), { workerData: { modelDir: this.modelDir } });
    const worker = this.worker;
    this.ready = new Promise((resolve, reject) => {
      const fail = error => {
        if (this.worker !== worker) return;
        reject(error);
        for (const task of this.pending.values()) task.reject(error);
        this.pending.clear();
        if (this.worker === worker) { this.worker = null; this.ready = null; }
      };
      worker.on("message", message => {
        if (message.ready) return resolve(message);
        const task = this.pending.get(message.id);
        if (!task) return;
        this.pending.delete(message.id);
        message.error ? task.reject(new Error(message.error)) : task.resolve(message.result);
      });
      worker.on("error", fail);
      worker.on("exit", code => fail(new Error(`快速转写引擎已退出（${code}），可重试。`)));
    });
    return this.ready;
  }

  async request(method, payload) {
    await this.start();
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, method, payload });
    });
  }

  health() { return this.request("health"); }
  transcribeFile(audioPath) { return this.request("file", audioPath); }
  transcribeTurns(audioPath, turns) { return this.request("turns", {audioPath, turns}); }
  transcribeLive(payload) { return this.request("live", payload); }
  clearSession(sessionId) { return this.request("clear", sessionId); }
  async close() { if (this.worker) await this.worker.terminate(); }
}
