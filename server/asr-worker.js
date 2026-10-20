import { parentPort, workerData } from "node:worker_threads";
import { ParaformerCore } from "./paraformer-core.js";

const engine = new ParaformerCore(workerData.modelDir);
parentPort.postMessage({ ready: true, loadSeconds: engine.loadSeconds });
let queue = Promise.resolve();
parentPort.on("message", ({ id, method, payload }) => {
  queue = queue.then(async () => {
    try {
      let result;
      if (method === "file") result = await engine.transcribeFile(payload);
      else if (method === "live") result = engine.transcribeLive(payload);
      else if (method === "clear") result = engine.clearSession(payload);
      else if (method === "health") result = { status: "ready", model: "Paraformer streaming int8", loadSeconds: engine.loadSeconds };
      else throw new Error("未知识别任务。");
      parentPort.postMessage({ id, result });
    } catch (error) { parentPort.postMessage({ id, error: error.message || String(error) }); }
  });
});
