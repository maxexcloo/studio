import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Router } from "express";
import type { RuntimeController } from "./controller.ts";

interface AdmissionOptions {
  controller: RuntimeController;
  workloadId: string;
  /** Server-side Radiance credential, never forwarded from a caller. */
  apiKey: string;
  /** Middleware must authenticate the Bifrost caller before this router. */
  fetchImpl?: typeof fetch;
}

/** Mount behind gateway authentication at /api/local-text. Target is direct Radiance. */
export function createTextAdmissionRouter({
  controller,
  workloadId,
  apiKey,
  fetchImpl = fetch,
}: AdmissionOptions) {
  const router = Router();
  router.post("/v1/chat/completions", async (request, response, next) => {
    const abort = new AbortController();
    response.once("close", () => {
      if (!response.writableFinished) abort.abort();
    });
    let lease: Awaited<ReturnType<RuntimeController["acquire"]>> | undefined;
    try {
      lease = await controller.acquire(workloadId);
      if (lease.workload.kind !== "text")
        throw new Error("Text admission requires a text workload.");
      const upstream = await fetchImpl(
        `${lease.workload.url.replace(/\/$/, "")}/v1/chat/completions`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify(request.body),
          signal: abort.signal,
          redirect: "error",
        },
      );
      response.status(upstream.status);
      response.setHeader(
        "Content-Type",
        upstream.headers.get("Content-Type") ?? "application/json",
      );
      response.setHeader("Cache-Control", "no-cache");
      if (upstream.body)
        await pipeline(
          Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream),
          response,
        );
      else response.end();
    } catch (error) {
      if (response.headersSent) response.destroy(error instanceof Error ? error : undefined);
      else next(error);
    } finally {
      lease?.release();
    }
  });
  return router;
}

/** Mount behind the existing administrator middleware. */
export function createRuntimeRouter(controller: RuntimeController) {
  const router = Router();
  router.get("/", (_request, response) =>
    response.json({
      automaticLifecycle: controller.automaticLifecycle,
      workloads: controller.status(),
    }),
  );
  return router;
}
