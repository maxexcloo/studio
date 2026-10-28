import { Router, type Request, type Response } from "express";
import { RuntimeRequestError, type RuntimeController } from "./controller.ts";

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
  router.get(
    "/operations/:id",
    handle((request) => controller.operation(String(request.params.id))),
  );
  return router;
}
