import {
  deleteRuntimeDocument,
  readRuntimeDocument,
  writeRuntimeDocument,
} from "../persistence/runtime.ts";

/** What a person did with a result. Dream adds "keep" and "discard". */
export type TasteKind = "star" | "unstar" | "compare" | "iterate";
export interface TasteSignal {
  at: string;
  kind: TasteKind;
  jobId?: string;
  prompt?: string;
  profileId?: string;
  loras?: string[];
}
/** One account's taste: the summary and the signals it learns from, newest first. */
export interface TasteRecord {
  summary: string;
  source: "studio" | "user";
  updatedAt: string;
  signals: TasteSignal[];
  /** Signals recorded since the summary was last written. */
  since: number;
}
interface Request {
  studioAccount?: { userId: string };
  body?: Record<string, unknown>;
}
interface Response {
  status(code: number): Response;
  json(value: unknown): unknown;
}
type Handler = (req: Request, res: Response) => unknown;
interface Router {
  get(path: string, handler: Handler): unknown;
  put(path: string, handler: Handler): unknown;
  delete(path: string, handler: Handler): unknown;
}

export const maxSummary = 1000;
const maxSignals = 200;
const maxPrompt = 300;
const owner = (req: Request) => req.studioAccount?.userId || "";
const empty = (): TasteRecord => ({
  summary: "",
  source: "studio",
  updatedAt: "",
  signals: [],
  since: 0,
});

/** A signal from a job's input or a gallery item's settings: its prompt, profile and enabled LoRAs. */
export function tasteSignal(
  kind: TasteKind,
  jobId: unknown,
  values: { prompt?: unknown; profileId?: unknown; loras?: unknown } = {},
): Omit<TasteSignal, "at"> {
  const prompt = typeof values.prompt === "string" ? values.prompt.trim().slice(0, maxPrompt) : "";
  const loras = (Array.isArray(values.loras) ? values.loras : [])
    .filter((lora) => typeof lora === "string" || lora?.enabled !== false)
    .map((lora) => String(typeof lora === "string" ? lora : lora?.name || ""))
    .filter(Boolean)
    .slice(0, 8);
  return {
    kind,
    ...(typeof jobId === "string" && jobId ? { jobId } : {}),
    ...(prompt ? { prompt } : {}),
    ...(typeof values.profileId === "string" && values.profileId
      ? { profileId: values.profileId }
      : {}),
    ...(loras.length ? { loras } : {}),
  };
}

/** Per-account taste records in the runtime document store, as `taste:<ownerId>`. */
export function createTaste({ dataDir, now = Date.now }: { dataDir: string; now?: () => number }) {
  const name = (ownerId: string) => `taste:${ownerId}`;
  function read(ownerId: string): TasteRecord {
    try {
      return { ...empty(), ...(readRuntimeDocument(dataDir, name(ownerId)) as TasteRecord) };
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") return empty();
      throw error;
    }
  }
  const write = (ownerId: string, record: TasteRecord) =>
    writeRuntimeDocument(dataDir, name(ownerId), record);
  const stamp = () => new Date(now()).toISOString();
  return {
    read,
    /** Adds signals newest first; a failure is logged, never passed to the request that caused it. */
    record(ownerId: string, signals: Omit<TasteSignal, "at">[]) {
      if (!signals.length) return;
      try {
        const record = read(ownerId);
        const at = stamp();
        record.signals = [
          ...signals.map((signal) => ({ at, ...signal })).reverse(),
          ...record.signals,
        ].slice(0, maxSignals);
        record.since += signals.length;
        write(ownerId, record);
      } catch (error) {
        console.warn(`[Studio] A taste signal was not saved: ${(error as Error).message}`);
      }
    },
    /** The person's own summary; Studio revises it from later signals without discarding it. */
    save(ownerId: string, summary: string) {
      const record = { ...read(ownerId), summary, source: "user" as const, updatedAt: stamp() };
      write(ownerId, record);
      return record;
    },
    forget(ownerId: string) {
      deleteRuntimeDocument(dataDir, name(ownerId));
    },
  };
}
export type Taste = ReturnType<typeof createTaste>;

/** The caller's own taste profile: read, edit and forget. */
export function registerTasteRoutes(app: Router, { taste }: { taste: Taste }) {
  const show = (record: TasteRecord) => ({
    summary: record.summary,
    source: record.source,
    updatedAt: record.updatedAt,
    signals: record.signals.length,
  });
  app.get("/api/taste", (req, res) => res.json(show(taste.read(owner(req)))));
  app.put("/api/taste", (req, res) => {
    const summary = req.body?.summary;
    if (typeof summary !== "string" || summary.trim().length > maxSummary)
      return res
        .status(400)
        .json({ ok: false, error: `Keep the taste profile to ${maxSummary} characters.` });
    return res.json(show(taste.save(owner(req), summary.trim())));
  });
  app.delete("/api/taste", (req, res) => {
    taste.forget(owner(req));
    return res.json(show(taste.read(owner(req))));
  });
}
