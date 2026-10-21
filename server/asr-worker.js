import { parentPort, workerData } from "node:worker_threads";
import { ParaformerCore } from "./paraformer-core.js";

const port=parentPort || {postMessage:message=>process.send(message),on:process.on.bind(process)};
if(!parentPort)process.once('disconnect',()=>process.exit(0));
const engine = new ParaformerCore(parentPort?workerData.modelDir:'.');
port.postMessage({ ready: true, loadSeconds: engine.loadSeconds });
let queue = Promise.resolve();
port.on("message", ({ id, method, payload }) => {
  queue = queue.then(async () => {
    try {
      let result;
      if (method === "file") result = await engine.transcribeFile(payload);
      else if (method === "turns") result = await engine.transcribeTurns(payload.audioPath, payload.turns);
      else if (method === "live") result = engine.transcribeLive(payload);
      else if (method === "clear") result = engine.clearSession(payload);
      else if (method === "health") result = { status: "ready", model: "Paraformer streaming int8", loadSeconds: engine.loadSeconds };
      else throw new Error("未知识别任务。");
      port.postMessage({ id, result });
    } catch (error) { port.postMessage({ id, error: error.message || String(error) }); }
  });
});
