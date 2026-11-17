import { type Request, type Response, Router } from "express";

import type { Benchmarks } from "./benchmarks.ts";
import { type RuntimeController, RuntimeRequestError } from "./controller.ts";

const workloadIds = (value: unknown) => {
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string"))
    throw new RuntimeRequestError("workloads must list workload ids.");
  return value as string[];
};

const handle =
  (action: (request: Request) => Promise<unknown> | unknown, status = 200) =>
  async (request: Request, response: Response) => {
    response.setHeader("Cache-Control", "no-store");
    try {
      response.status(status).json(await action(request));
    } catch (error) {
      const known = error as Error & { status?: number };
      response.status(known.status ?? 500).json({
        error: known.status ? known.message : "Studio couldn't complete the runtime request.",
      });
    }
  };

/** The last `lines` (1–1000, else 200) of each pod's log. */
function logLines(request: Request) {
  const lines = Math.trunc(Number(request.query.lines));
  return Number.isFinite(lines) ? Math.min(Math.max(lines, 1), 1000) : 200;
}

/** Mount behind the existing administrator middleware. Apply and restart answer at once; poll the operation. */
export function createRuntimeRouter(
  controller: RuntimeController,
  benchmarks: Benchmarks,
  requestedBy: (request: Request) => string,
) {
  const router = Router();
  router.get(
    "/",
    handle(() => controller.observe()),
  );
  router.post(
    "/preview",
    // `start` previews starting one of these workloads beside what runs; `workloads` is a complete placement.
    handle((request) =>
      request.body?.start
        ? controller.previewStart(workloadIds(request.body.start))
        : controller.preview(workloadIds(request.body?.workloads)),
    ),
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
      (request) =>
        controller.restart(
          String(request.body?.workload ?? ""),
          requestedBy(request),
          request.body?.force === true,
        ),
      202,
    ),
  );
  router.post(
    "/workloads/:id/cancel-queue",
    handle((request) => controller.cancelQueue(String(request.params.id))),
  );
  router.get(
    "/workloads/:id/logs",
    handle((request) => controller.logs(String(request.params.id), logLines(request))),
  );
  router.get(
    "/benchmarks",
    handle(() => benchmarks.list()),
  );
  router.post(
    "/benchmarks",
    handle(
      (request) => benchmarks.start(String(request.body?.workload ?? ""), requestedBy(request)),
      202,
    ),
  );
  router.get(
    "/benchmarks/:id/logs",
    handle((request) => benchmarks.logs(String(request.params.id), logLines(request))),
  );
  router.post(
    "/benchmarks/:id/stop",
    handle((request) => benchmarks.stop(String(request.params.id))),
  );
  router.get(
    "/operations/:id",
    handle((request) => controller.operation(String(request.params.id))),
  );
  router.post(
    "/operations/:id/cancel",
    handle((request) => controller.cancel(String(request.params.id), requestedBy(request))),
  );
  return router;
}
