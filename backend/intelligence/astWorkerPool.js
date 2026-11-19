import { Worker } from "node:worker_threads";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workerPath = path.join(__dirname, "astWorker.js");

class AstWorkerPool {
  constructor(size = Math.min(4, Math.max(1, os.cpus().length - 1))) {
    this.size = size;
    this.workers = [];
    this.freeWorkers = [];
    this.queue = [];
    this.pendingJobs = new Map();
    this.nextJobId = 1;
    this.init();
  }

  init() {
    for (let i = 0; i < this.size; i++) {
      const worker = new Worker(workerPath);
      const workerWrapper = { id: i, worker };

      worker.on("message", (msg) => {
        const { id, ok, result, error } = msg;
        const job = this.pendingJobs.get(id);
        if (job) {
          this.pendingJobs.delete(id);
          if (ok) job.resolve(result);
          else job.reject(new Error(error));
        }

        this.freeWorkers.push(workerWrapper);
        this.processQueue();
      });

      worker.on("error", (err) => {
        console.error(`[AstWorkerPool] Worker ${i} encountered error:`, err);
      });

      this.workers.push(workerWrapper);
      this.freeWorkers.push(workerWrapper);
    }
  }

  processQueue() {
    while (this.queue.length > 0 && this.freeWorkers.length > 0) {
      const job = this.queue.shift();
      const workerWrapper = this.freeWorkers.pop();
      this.pendingJobs.set(job.id, job);
      workerWrapper.worker.postMessage({
        id: job.id,
        filePath: job.filePath,
        content: job.content,
        runtime: job.runtime
      });
    }
  }

  parseFile(filePath, content, runtime = null) {
    return new Promise((resolve, reject) => {
      const id = this.nextJobId++;
      this.queue.push({ id, filePath, content, runtime, resolve, reject });
      this.processQueue();
    });
  }

  async parseFiles(files) {
    return Promise.all(
      files.map((file) => this.parseFile(file.path, file.content || "", file.language || null))
    );
  }

  terminate() {
    for (const w of this.workers) {
      w.worker.terminate();
    }
    this.workers = [];
    this.freeWorkers = [];
  }
}

export const astWorkerPool = new AstWorkerPool();
