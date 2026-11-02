export interface CloudRequest {
  kind: "image" | "video";
  model: string;
  prompt: string;
  width: number;
  height: number;
  duration: number;
  resolution: string;
  count: number;
  reference?: Uint8Array;
}
interface ProviderImage {
  b64_json?: string;
  url?: string;
}
interface ProviderVideo {
  status: string;
  video?: { url?: string };
  video_url?: string;
  output_url?: string;
}

const prefixes = { image: "grok-imagine-image", video: "grok-imagine-video" };
// The aspect ratios the provider's video models accept.
const videoAspects = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"];
function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}
/** The accepted video aspect ratio closest to a width and height, such as a first frame's. */
export function videoAspect(width: number, height: number): string {
  const distance = (aspect: string) => {
    const [w, h] = aspect.split(":").map(Number);
    return Math.abs(Math.log(width / height) - Math.log(w / h));
  };
  return videoAspects.reduce((best, aspect) => (distance(aspect) < distance(best) ? aspect : best));
}

/** CLIProxyAPI's Grok image and video wire contracts. */
export class CliProxyMedia {
  private base: string;
  private key: string;
  private fetchImpl: typeof fetch;
  private cached?: { expires: number; models: string[] };

  constructor(base: string, key: string, fetchImpl = fetch) {
    const endpoint = new URL(base);
    if (
      !["http:", "https:"].includes(endpoint.protocol) ||
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash
    )
      throw new Error("STUDIO_CLIPROXYAPI_URL must be a plain provider HTTP(S) base URL.");
    if (!key) throw new Error("STUDIO_CLIPROXYAPI_KEY is required.");
    this.base = base.replace(/\/$/, "");
    this.key = key;
    this.fetchImpl = fetchImpl;
  }

  private async call<T>(route: string, body?: object | FormData, signal?: AbortSignal): Promise<T> {
    const multipart = body instanceof FormData;
    const response = await this.fetchImpl(this.base + route, {
      method: body ? "POST" : "GET",
      redirect: "error",
      signal: signal || AbortSignal.timeout(300_000),
      headers: {
        Authorization: `Bearer ${this.key}`,
        ...(body && !multipart ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: multipart ? body : JSON.stringify(body) } : {}),
    });
    if (!response.ok) {
      // The provider's own message says why it refused (moderation, size, parameters); keep it short.
      const text = await response.text().catch(() => "");
      let detail = text;
      try {
        const answer = JSON.parse(text);
        detail = String(answer?.error?.message || answer?.error || answer?.message || text);
      } catch {
        // A plain-text refusal is the message itself.
      }
      const reason = detail.replace(/\s+/g, " ").trim().slice(0, 200);
      throw Object.assign(
        new Error(
          `CLIProxyAPI returned HTTP ${response.status}${reason ? `: ${reason}` : "; inspect provider health."}`,
        ),
        { providerRejected: response.status >= 400 && response.status < 500 },
      );
    }
    return (await response.json()) as T;
  }

  async models(): Promise<string[]> {
    if (!this.cached || this.cached.expires < Date.now()) {
      const result = await this.call<{ data: { id: string }[] }>(
        "/v1/models",
        undefined,
        AbortSignal.timeout(5000),
      );
      this.cached = {
        expires: Date.now() + 60_000,
        models: result.data
          .map((model) => model.id)
          .filter((id) =>
            Object.values(prefixes).some((prefix) => id === prefix || id.startsWith(prefix + "-")),
          )
          .sort(),
      };
    }
    return this.cached.models;
  }

  async select(kind: CloudRequest["kind"], model: string): Promise<string> {
    const choices = (await this.models()).filter(
      (id) => id === prefixes[kind] || id.startsWith(prefixes[kind] + "-"),
    );
    const selected = model || choices[0];
    if (!selected || !choices.includes(selected))
      throw new Error(`Choose an advertised CLIProxyAPI ${kind} model.`);
    return selected;
  }

  async image(input: CloudRequest, signal: AbortSignal): Promise<ProviderImage[]> {
    const fields: Record<string, unknown> = {
      model: input.model,
      prompt: input.prompt,
      response_format: "b64_json",
      size: `${input.width}x${input.height}`,
      ...(input.resolution ? { resolution: input.resolution } : {}),
    };
    let body: object | FormData = fields;
    if (input.model === "grok-imagine-image-2.0") {
      delete fields.size;
      const divisor = gcd(input.width, input.height);
      fields.aspect_ratio = `${input.width / divisor}:${input.height / divisor}`;
      if (input.reference)
        fields.image = {
          type: "image_url",
          url: `data:image/jpeg;base64,${Buffer.from(input.reference).toString("base64")}`,
        };
    } else if (input.reference) {
      const form = new FormData();
      for (const [key, value] of Object.entries(fields)) form.set(key, String(value));
      form.set(
        "image",
        new Blob([new Uint8Array(input.reference)], { type: "image/jpeg" }),
        "reference.jpg",
      );
      body = form;
    }
    const result = await this.call<{ data: ProviderImage[] }>(
      input.reference ? "/v1/images/edits" : "/v1/images/generations",
      body,
      signal,
    );
    return result.data;
  }

  async video(input: CloudRequest, signal: AbortSignal): Promise<string> {
    const result = await this.call<{ request_id?: string }>(
      "/v1/videos/generations",
      {
        model: input.model,
        prompt: input.prompt,
        aspect_ratio: videoAspect(input.width, input.height),
        duration: input.duration,
        ...(input.resolution ? { resolution: input.resolution } : {}),
        ...(input.reference
          ? {
              image: {
                url: `data:image/jpeg;base64,${Buffer.from(input.reference).toString("base64")}`,
              },
            }
          : {}),
      },
      signal,
    );
    if (!result.request_id)
      throw new Error(
        "CLIProxyAPI returned no video request ID; inspect provider before retrying.",
      );
    return result.request_id;
  }

  poll(id: string): Promise<ProviderVideo> {
    return this.call(
      `/v1/videos/${encodeURIComponent(id)}`,
      undefined,
      AbortSignal.timeout(10_000),
    );
  }

  async download(url: string, signal?: AbortSignal): Promise<Uint8Array> {
    if (new URL(url).protocol !== "https:")
      throw new Error("Provider media must use an HTTPS download URL.");
    // Provider download URLs receive no API credential, including on redirects.
    const response = await this.fetchImpl(url, {
      signal: signal || AbortSignal.timeout(300_000),
      redirect: "follow",
    });
    if (!response.ok) throw new Error(`Provider media returned HTTP ${response.status}.`);
    return new Uint8Array(await response.arrayBuffer());
  }
}

export function configuredCliProxy(environment = process.env): CliProxyMedia | undefined {
  const base = environment.STUDIO_CLIPROXYAPI_URL;
  if (!base) return;
  return new CliProxyMedia(base, environment.STUDIO_CLIPROXYAPI_KEY || "");
}
