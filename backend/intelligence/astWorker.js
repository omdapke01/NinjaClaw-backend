import { parentPort } from "node:worker_threads";
import { parseFileAST } from "./astParser.js";

if (!parentPort) {
  throw new Error("astWorker must be run as a worker thread");
}

parentPort.on("message", async (message) => {
  const { id, filePath, content, runtime } = message;
  try {
    const result = await parseFileAST(filePath, content, runtime);
    parentPort.postMessage({ id, ok: true, result });
  } catch (err) {
    parentPort.postMessage({ id, ok: false, error: err.message });
  }
});
