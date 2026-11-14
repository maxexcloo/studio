import { Router, type Request, type Response } from "express";
import { RuntimeRequestError, type RuntimeController } from "./controller.ts";

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
        error: known.status ? known.message : "Studio couldn’t complete the runtime request.",
      });
    }
  };

/** Mount behind the existing administrator middleware. Apply and restart answer at once; poll the operation. */
export function createRuntimeRouter(
  controller: RuntimeController,
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
      (request) => controller.restart(String(request.body?.workload ?? ""), requestedBy(request)),
      202,
    ),
  );
  router.put(
    "/settings",
    handle((request) =>
      controller.configure({
        automatic: request.body?.automatic,
        parkIdleMinutes: request.body?.parkIdleMinutes,
        idleWorkload: request.body?.idleWorkload,
        everyoneSwaps: request.body?.everyoneSwaps,
      }),
    ),
  );
  router.get(
    "/workloads/:id/logs",
    // The last `lines` (1–1000, else 200) of each pod's log.
    handle((request) => {
      const lines = Math.trunc(Number(request.query.lines));
      return controller.logs(
        String(request.params.id),
        Number.isFinite(lines) ? Math.min(Math.max(lines, 1), 1000) : 200,
      );
    }),
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

/**
 * `POST /api/queue/:id/swap` for the caller's waiting media work that running text holds the GPUs
 * for: without `signature` it previews the swap, with one it applies it. Administrators may always
 * swap, ordinary accounts only with Let Everyone Swap Models on. `workloads` gives a waiting job's
 * deployments, none when the caller has no such job.
 */
export function createSwapRouter(
  controller: RuntimeController,
  {
    admin,
    workloads,
    requestedBy,
  }: {
    admin: (request: Request) => boolean;
    workloads: (request: Request, id: string) => string[];
    requestedBy: (request: Request) => string;
  },
) {
  const router = Router();
  router.post(
    "/api/queue/:id/swap",
    handle((request) => {
      if (!admin(request) && !controller.settings.everyoneSwaps)
        throw Object.assign(new Error("Only an administrator can swap models."), { status: 403 });
      const candidates = workloads(request, String(request.params.id));
      if (!candidates.length)
        throw Object.assign(new Error("No waiting work of yours has that id."), { status: 404 });
      return request.body?.signature
        ? controller.swap(candidates, String(request.body.signature), requestedBy(request))
        : controller.previewSwap(candidates);
    }),
  );
  return router;
}
