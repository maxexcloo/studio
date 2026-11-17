// The control key's GPU placement tools, which drive Studio's RuntimeController (runtime/controller.ts).
import { z } from "zod";

import { mcpJson } from "./media.js";

export const controlInstructions =
  "GPU placement is manual: use these tools only on explicit request, and present a preview or mode preview and get approval before apply. Call restart only for what the user names. Media generation never changes the placement.";

/**
 * The control `mode` tool's preset placement from the configured workloads and their observed
 * phases, by what each workload runs (its capabilities, else its kind): a running one first, then
 * list order. Workloads in other GPU pools keep running as they are.
 */
export function presetPlacement(mode, configured, observed) {
  const running = (item) => ["running", "starting"].includes(item.phase);
  const up = new Set(observed.filter(running).map((item) => item.id));
  const runs = {
    image: "images",
    text: "images and text",
    video: "videos",
  };
  const pick = (capability, gpus, taken = "") => {
    const fits = configured.filter((item) => {
      const capabilities = item.capabilities ?? [item.kind];
      return (
        (gpus === undefined || item.gpus === gpus) &&
        item.id !== taken &&
        capabilities.includes(capability) &&
        (capability !== "text" || capabilities.includes("image"))
      );
    });
    const found = fits.find((item) => up.has(item.id)) ?? fits[0];
    if (!found)
      throw new Error(
        `No ${taken ? "other " : ""}${gpus ? `${gpus}-GPU ` : ""}workload that runs ${runs[capability]} is configured.`,
      );
    return found;
  };
  // Video is picked first, so a workload that runs both isn't taken for images when it alone runs video.
  const video = mode === "image_video" ? pick("video", 1) : undefined;
  const anchor =
    mode === "video"
      ? pick("video", 2)
      : mode === "image_text"
        ? pick("text")
        : pick("image", 1, video?.id);
  const elsewhere = observed
    .filter((item) => item.pool !== anchor.pool && running(item))
    .map((item) => item.id);
  return [anchor.id, ...(video ? [video.id] : []), ...elsewhere];
}

export function registerGpuTools({ tool, server, runtime, workerStatus }) {
  const workloadList = z.array(z.string().min(1)).max(32);
  const modePlacement = async (mode) =>
    presetPlacement(mode, runtime.workloads, (await runtime.observe()).workloads);
  tool(
    server,
    "gpu_status",
    "gpu status",
    "Read each GPU workload's state, the GPUs in use and the current or last runtime change, and each worker's health, running job, queued jobs, loaded model, free memory and when it should be free (freeAt, epoch ms).",
    {},
    async () => mcpJson({ ...(await runtime.observe()), workers: await workerStatus() }),
    { readOnlyHint: true },
  );
  tool(
    server,
    "workloads",
    "list workloads",
    "List the GPU workloads Studio can run, with their kind, what they run (text: local text while running), GPU pool and GPU count.",
    {},
    () =>
      mcpJson({
        pools: runtime.pools,
        workloads: runtime.workloads.map(({ id, label, kind, capabilities, pool, gpus }) => ({
          id,
          label,
          kind,
          capabilities: capabilities ?? [kind],
          pool,
          gpus,
        })),
      }),
    { readOnlyHint: true },
  );
  tool(
    server,
    "preview",
    "preview placement",
    "Preview a COMPLETE placement without applying it: the listed workload ids run and every other stops; an empty list stops all. Present the changes for approval; discard to cancel.",
    { workloads: workloadList },
    async ({ workloads }) => mcpJson(await runtime.preview(workloads)),
    { readOnlyHint: true },
  );
  tool(
    server,
    "apply",
    "apply placement",
    "Apply an explicitly requested placement only after its preview was presented and approved, with its exact signature. Studio waits for accepted work on stopping workloads, then switches; poll operation. Never use it for media generation.",
    {
      workloads: workloadList,
      signature: z.string().min(1),
      confirmed: z.boolean().default(false),
    },
    async ({ workloads, signature, confirmed }) => {
      if (!confirmed)
        throw new Error("Present the preview and obtain approval before applying this placement.");
      return mcpJson(await runtime.apply(workloads, signature, "control-mcp"));
    },
    { destructiveHint: true },
  );
  tool(
    server,
    "mode",
    "preview gpu mode",
    "Preview a preset placement only when the user asks for it: image_text (a workload that runs images and serves local text), image_video (two one-GPU workloads, one running images and one video) or video (a two-GPU workload that runs video). Present the changes for approval, then apply the returned workloads and signature.",
    {
      mode: z.enum(["image_text", "image_video", "video"]),
    },
    async ({ mode }) => mcpJson(await runtime.preview(await modePlacement(mode))),
    { readOnlyHint: true },
  );
  tool(
    server,
    "restart",
    "restart workload",
    "Restart a running workload in place, only when the user asks: Studio waits for its accepted work, scales it to 0 and back to 1. workload is an id from gpu_status. Never starts a stopped workload or changes the placement.",
    { workload: z.string().min(1) },
    async ({ workload }) => mcpJson(await runtime.restart(workload, "control-mcp")),
    { destructiveHint: true },
  );
  tool(
    server,
    "operation",
    "check operation",
    "Read the runtime change returned by apply or restart, without waiting.",
    { job_id: z.string().regex(/^[a-zA-Z0-9]{1,64}$/) },
    ({ job_id }) => mcpJson(runtime.operation(job_id)),
    { readOnlyHint: true },
  );
}
