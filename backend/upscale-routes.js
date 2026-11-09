import { recordBelongsToAccount, recordsForRequest } from "./account-ownership.js";
import {
  currentComfyBackend,
  isDefaultBackend,
  routeJob,
  withComfyBackend,
} from "./comfy/backends.js";
import { getCustomWorkflow } from "./custom-workflows.js";
import { gallery, galleryRevisionValue, updateGalleryJob } from "./gallery/store.js";
import { referenceAssetForAccount, stageReferenceAssetsForAccount } from "./references.js";
import { findUpscaleTarget, prepareUpscale, toggleUpscaleView } from "./upscale-jobs.js";
import {
  normalizeQuality,
  upscaleQualities,
  upscaleStatus,
  upscaleTargets,
  uploadUpscaleVideoSource,
} from "./upscale.js";
import { noWorkerMessage, workerById } from "./workers.js";

/**
 * Smart upscale: its status, queuing an upscale of a gallery item and switching the view between
 * the upscale and the original. Answers `queueUpscale` and `upscaleReady` for Finish Starred
 * Images (domain/finishing.ts), which `finishing` is told of each queued job.
 */
export function registerUpscaleRoutes(app, { finishing, loadComfyContext, queue, store }) {
  /**
   * Upscaling runs on a worker with Upscale (workers.js): the routes below run
   * inside its scope, so its node list, uploads and the job itself all go there.
   */
  function onUpscaleWorker(handler) {
    return (req, res) => {
      const worker = routeJob("upscale");
      if (!worker) {
        const { status, payload } = noUpscaleWorker();
        res.status(status).json(payload);
        return undefined;
      }
      return withComfyBackend(worker.id, () => handler(req, res));
    };
  }
  const noUpscaleWorker = () => ({
    status: 503,
    payload: {
      ok: false,
      offline: true,
      noWorker: true,
      error: noWorkerMessage("upscale"),
    },
  });

  /** `force` reads ComfyUI again instead of the 30s cache. */
  async function upscaleInfo({ force = false } = {}) {
    try {
      return { info: (await loadComfyContext({ force })).info };
    } catch {
      return {
        failure: {
          status: 503,
          payload: {
            ok: false,
            offline: true,
            error: `${isDefaultBackend() ? "ComfyUI" : workerById(currentComfyBackend())?.name || "The upscale worker"} is offline, so smart upscale isn’t available.`,
          },
        },
      };
    }
  }
  const upscaleUnready = (status) =>
    status.nodesInstalled
      ? "The SeedVR2 models aren’t installed yet."
      : `ComfyUI is missing the SeedVR2 nodes: ${status.missingNodes.join(", ")}.`;
  async function upscaleContext(res, options) {
    const { info, failure } = await upscaleInfo(options);
    if (failure) res.status(failure.status).json(failure.payload);
    return info || null;
  }

  app.get(
    "/api/upscale/status",
    onUpscaleWorker(async (req, res) => {
      const info = await upscaleContext(res, { force: req.query.fresh === "1" });
      if (!info) return;
      const status = {
        ...upscaleStatus(info, req.query.quality),
        qualities: upscaleQualities,
        targets: upscaleTargets,
      };
      res.json({ ok: true, ...status });
    }),
  );

  /**
   * Queues a smart upscale of one of the account's gallery items on a worker with Upscale, answering
   * `{ status, payload }` as the route sends it. `origin` sets the queue tier (Finish Starred Images).
   */
  async function queueUpscale(account, request, origin) {
    const worker = routeJob("upscale");
    if (!worker) return noUpscaleWorker();
    return withComfyBackend(worker.id, () => queueUpscaleOnWorker(account, request, origin));
  }

  async function queueUpscaleOnWorker(account, request, origin) {
    const target = request.target === undefined ? 0 : Number(request.target);
    if (target !== 0 && !upscaleTargets.includes(target)) {
      return {
        status: 400,
        payload: {
          ok: false,
          error: "Choose an upscale target of 2048 or 4096, or 0 for automatic sizing.",
        },
      };
    }
    const { info, failure } = await upscaleInfo();
    if (failure) return failure;
    const quality = normalizeQuality(request.quality);
    const itemId = String(request.galleryItemId || "");
    const ownedItem = gallery.find(
      (item) => item.id === itemId && recordBelongsToAccount(item, account),
    );
    if (account && !ownedItem)
      return {
        status: 404,
        payload: { ok: false, reason: "missing", error: "This image is no longer in the gallery." },
      };
    const faceDetail =
      Boolean(request.faceDetail) && (ownedItem || findUpscaleTarget(itemId))?.type !== "video";
    const status = upscaleStatus(info, quality);
    if (!status.ready)
      return {
        status: 400,
        payload: { ok: false, error: upscaleUnready(status), status },
      };
    if (faceDetail && !status.faceDetail.nodesInstalled)
      return {
        status: 400,
        payload: {
          ok: false,
          error: `Face detail needs the Impact Pack nodes: ${status.faceDetail.missingNodes.join(", ")}.`,
        },
      };
    // Say exactly why an image cannot be upscaled; the tile shows this in a popover.
    const item = findUpscaleTarget(itemId);
    if (!item)
      return {
        status: 404,
        payload: {
          ok: false,
          reason: "missing",
          error:
            "This image is no longer in the gallery. It may have been deleted on another device. Reload the page.",
        },
      };
    if (!["image", "video"].includes(item.type))
      return {
        status: 400,
        payload: {
          ok: false,
          reason: "video",
          error: "Upscale supports gallery images and videos.",
        },
      };
    if (item.status !== "done")
      return {
        status: 409,
        payload: {
          ok: false,
          reason: "unfinished",
          error: "This image is still rendering. Upscale it when it’s done.",
        },
      };
    if (["queued", "running"].includes(item.upscale?.status))
      return {
        status: 409,
        payload: { ok: false, error: "This image is already being upscaled." },
      };
    let imageName = "";
    let upscaleItem = item;
    try {
      if (item.type === "video") {
        imageName = await uploadUpscaleVideoSource(item);
      } else {
        const asset = referenceAssetForAccount(account, item.id);
        const [staged] = await stageReferenceAssetsForAccount(account, [
          { assetId: asset.id, slot: "upscale", source: asset.source },
        ]);
        imageName = staged?.comfyName || "";
        if (staged) {
          if (
            !(
              Number.isFinite(staged.width) &&
              staged.width > 0 &&
              Number.isFinite(staged.height) &&
              staged.height > 0
            )
          )
            throw new Error("The source image dimensions could not be read.");
          upscaleItem = { ...item, width: staged.width, height: staged.height };
        }
      }
    } catch (error) {
      return {
        status: 400,
        payload: {
          ok: false,
          reason: "source",
          error: `Couldn’t read the original image: ${error.message}`,
        },
      };
    }
    if (!imageName)
      return {
        status: 502,
        payload: {
          ok: false,
          reason: "source",
          error:
            "ComfyUI didn’t accept the original image. Make sure ComfyUI is running and can write to its input folder.",
        },
      };
    const customWorkflow = String(item.model || "").startsWith("custom:")
      ? getCustomWorkflow(item.model, item.settings?.profileBackend)
      : null;
    const { body, plan } = prepareUpscale({
      item: upscaleItem,
      imageName,
      quality,
      target,
      faceDetail,
      info,
      customWorkflow,
    });
    const ownerId = account?.userId || "";
    const parent = item.jobId && store.job(ownerId, item.jobId);
    const [queued] = store.enqueueAll(
      ownerId,
      () =>
        parent
          ? parent.sessionId
          : store.createSession(ownerId, "Upscale", { prompt: item.prompt || "" }).id,
      [
        {
          input: {
            prompt: item.prompt || "",
            galleryItemId: item.id,
            upscaleBody: body,
            upscalePlan: plan,
          },
          operation: "upscale",
          parentJobId: parent?.id,
          resource: `worker:${currentComfyBackend()}`,
          origin,
        },
      ],
    );
    updateGalleryJob(item.id, {
      upscale: { ...item.upscale, status: "queued", jobId: queued.id, progress: null, error: "" },
    });
    finishing.admitted(queued);
    void queue.tick();
    return {
      status: 200,
      payload: { ok: true, jobId: queued.id, plan, revision: galleryRevisionValue() },
    };
  }

  app.post("/api/upscale", async (req, res) => {
    const { status, payload } = await queueUpscale(req.studioAccount, req.body || {});
    res.status(status).json(payload);
  });

  app.post("/api/upscale/toggle", (req, res) => {
    try {
      const itemId = String(req.body?.galleryItemId || "");
      const ownedItem = recordsForRequest(gallery, req).find((item) => item.id === itemId);
      if (req.studioAccount && !ownedItem)
        return res
          .status(404)
          .json({ ok: false, error: "This image is no longer in the gallery." });
      const item = toggleUpscaleView(itemId, req.body?.active);
      res.json({
        ok: true,
        upscaleActive: Boolean(item.upscaleActive),
        revision: galleryRevisionValue(),
      });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  /** Whether a worker can run a smart upscale at this quality now, or the reason it cannot. */
  async function upscaleReady(quality) {
    const worker = routeJob("upscale");
    if (!worker) return { reason: noWorkerMessage("upscale") };
    return withComfyBackend(worker.id, async () => {
      const { info, failure } = await upscaleInfo();
      if (failure) return { reason: failure.payload.error };
      const status = upscaleStatus(info, quality);
      if (!status.ready) return { reason: upscaleUnready(status) };
      return {
        faceDetail: status.faceDetail.nodesInstalled && status.faceDetail.detectors.length > 0,
      };
    });
  }

  return { queueUpscale, upscaleReady };
}
