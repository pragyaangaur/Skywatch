// The on-device language model. It runs in the reader's browser through WebLLM and WebGPU,
// so questions never leave the device and nothing is billed. It is opt-in because the first
// load downloads the model weights, which is a lot on a mobile data plan.

const WEBLLM_URL = "https://esm.run/@mlc-ai/web-llm";

// Qwen 2.5 writes Hindi much better than other models of this size. The smaller one is the
// fallback when the larger one does not fit in the device's GPU memory.
export const MODELS = [
  { id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC", megabytes: 1100 },
  { id: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC", megabytes: 400 },
];

export const supported = () => typeof navigator !== "undefined" && !!navigator.gpu;

export class Helper {
  // small: start with the 400 MB model, for phones or slow connections.
  constructor(onProgress = () => {}, { small = false } = {}) {
    this.onProgress = onProgress;
    this.models = small ? MODELS.slice(1) : MODELS;
    this.engine = null;
    this.model = null;
    this.loading = null;
  }

  get ready() {
    return !!this.engine;
  }

  load() {
    this.loading = this.loading || this.#load();
    return this.loading;
  }

  async #load() {
    if (!supported()) throw new Error("no-webgpu");
    const webllm = await import(/* @vite-ignore */ WEBLLM_URL);
    for (const m of this.models) {
      try {
        this.onProgress({ ratio: 0, text: `about ${m.megabytes} MB` });
        this.engine = await webllm.CreateMLCEngine(m.id, {
          initProgressCallback: (r) => this.onProgress({ ratio: r.progress ?? 0, text: r.text }),
        });
        this.model = m;
        this.onProgress({ ratio: 1, done: true });
        return m;
      } catch (e) {
        console.warn(`could not load ${m.id}`, e);
      }
    }
    this.loading = null;
    throw new Error("load-failed");
  }

  // Yields the reply as it is written.
  async *answer(messages) {
    const chunks = await this.engine.chat.completions.create({ messages, stream: true, temperature: 0.4, max_tokens: 60 });
    for await (const c of chunks) {
      const d = c.choices[0]?.delta?.content;
      if (d) yield d;
    }
  }
}
