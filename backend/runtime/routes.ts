import { Readable } from "node:stream";
import { finished } from "node:stream/promises";
import { Router, type Request, type Response } from "express";
import { RuntimeRequestError, type RuntimeController } from "./controller.ts";

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
    let lease: Awaited<ReturnType<RuntimeController["acquire"]>> | undefined;
    try {
      lease = await controller.acquire(workloadId);
      if (response.destroyed) return;
      if (lease.workload.kind !== "text")
        throw new Error("Text admission requires a text workload.");
      const upstream = await fetchImpl(
        `${lease.workload.url.replace(/\/$/, "")}/v1/chat/completions`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(request.body),
          redirect: "error",
        },
      );
      response.status(upstream.status);
      response.setHeader(
        "Content-Type",
        upstream.headers.get("Content-Type") ?? "application/json",
      );
      response.setHeader("Cache-Control", "no-cache");
      if (upstream.body) {
        const source = Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream);
        // A closed caller cannot prove Radiance stopped. Keep consuming its response before switching GPUs.
        const drain = () => {
          source.unpipe(response);
          source.resume();
        };
        response.once("close", drain);
        const completion = finished(source, { cleanup: true });
        if (response.destroyed) drain();
        else source.pipe(response);
        try {
          await completion;
        } finally {
          response.off("close", drain);
        }
      } else response.end();
    } catch (error) {
      if (response.headersSent) response.destroy(error instanceof Error ? error : undefined);
      else next(error);
    } finally {
      lease?.release();
    }
  });
  return router;
}

const workloadIds = (value: unknown) => {
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string"))
    throw new RuntimeRequestError("workloads must list workload ids.");
  return value as string[];
};

/** Mount behind the existing administrator middleware. Apply and restart answer at once; poll the operation. */
export function createRuntimeRouter(
  controller: RuntimeController,
  requestedBy: (request: Request) => string,
) {
  const router = Router();
  const handle =
    (action: (request: Request) => Promise<unknown> | unknown, status = 200) =>
    async (request: Request, response: Response) => {
      response.setHeader("Cache-Control", "no-store");
      try {
        response.status(status).json(await action(request));
      } catch (error) {
        const known = error as Error & { status?: number };
        response.status(known.status ?? 500).json({
          error: known.status ? known.message : "Studio couldn’t complete the runtime request.",
        });
      }
    };
  router.get(
    "/",
    handle(() => controller.observe()),
  );
  router.post(
    "/preview",
    handle((request) => controller.preview(workloadIds(request.body?.workloads))),
  );
  router.post(
    "/apply",
    handle(
      (request) =>
        controller.apply(
          workloadIds(request.body?.workloads),
          String(request.body?.signature ?? ""),
          requestedBy(request),
        ),
      202,
    ),
  );
  router.post(
    "/restart",
    handle(
      (request) => controller.restart(String(request.body?.workload ?? ""), requestedBy(request)),
      202,
    ),
  );
  router.get(
    "/operations/:id",
    handle((request) => controller.operation(String(request.params.id))),
  );
  return router;
}
