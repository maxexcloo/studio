import { loraInfos } from "./lora-info.js";
import { optionalLoraIssue } from "./lora-catalogue.js";
import {
  currentComfyBackend,
  isDefaultBackend,
  routeProfile,
  withComfyBackend,
} from "./comfy-backends.js";
import {
  capabilityForProfile,
  listWorkers,
  noWorkerMessage,
  workerById,
  workerHas,
} from "./workers.js";
import crypto from "node:crypto";
import { demoMode } from "./comfy.js";
import { families } from "./family-catalog.js";
import { sanitizeGenerateBody, validateReferenceSlots } from "./validation.js";
import {
  dedupeGallery,
  gallery,
  galleryLimit,
  makePendingItems,
  setGallery,
  galleryRevisionValue,
  storedChatRecord,
} from "./gallery-store.js";
import { recordPrompt } from "./prompt-history.js";
import { jobs, runJob, runMockJob } from "./jobs.js";
import { getCustomWorkflow } from "./custom-workflows.js";
import { markWorkflowUsed } from "./workflow-catalog.js";

import { forgetComfyRun } from "./comfy-traces.js";
import { inpaintInputNames, prepareInpaint } from "./inpaint.js";
import { referenceExistsForAccount, stageReferenceAssets } from "./reference-assets.js";
import { comfyRestarting } from "./comfy-restart.js";
import { upscaleQualities, upscaleTargets } from "./upscale.js";
import { dropsAutoUpscale, planRunUpscale } from "./run-upscale.js";
import { ownerIdForRequest } from "./account-ownership.js";
import { mayUseFeature, mayUseGenerationProfile } from "./account-policy.js";
import { configuredAccountJobLimit, reserveAccountJob } from "./account-jobs.js";
import { assistantRecord } from "./assistant-routes.js";

export function registerGenerationRoutes(app, { loadComfyContext, mediaModels, comfyDownMessage }) {
  const submissions = new Map();
  const accountReservations = new Map();
  const accountJobLimit = configuredAccountJobLimit();
  const generate = async (req, res) => {
    const id = String(req.body?.clientJobId || "").replace(/[^\w-]/g, "");
    // Serialise retries before any asynchronous image staging or backend work.
    // Once acknowledged, the job below answers repeats without staging again.
    let release;
    if (id) {
      while (submissions.has(id)) await submissions.get(id);
      submissions.set(
        id,
        new Promise((resolve) => {
          release = resolve;
        }),
      );
    }
    let releaseReservation = () => {};
    try {
      if (req.studioAccount?.role === "user" && !(id && jobs.has(id))) {
        const reservation = reserveAccountJob(
          req.studioAccount.userId,
          jobs,
          accountReservations,
          accountJobLimit,
        );
        if (!reservation.accepted) {
          return res.status(429).json({
            ok: false,
            reason: "job-limit",
            error: `You can have up to ${accountJobLimit} outstanding jobs.`,
          });
        }
        releaseReservation = reservation.release;
      }
      await dispatchGenerate(req, res);
    } finally {
      releaseReservation();
      if (id) {
        submissions.delete(id);
        release();
      }
    }
  };
  let admission;
  app.post("/api/generate", (req, res) => (admission ? admission(req, res) : generate(req, res)));

  /**
   * Which worker runs this generation (workers.js): one that has the
   * capability its profile needs, preferring an online one with the model, and
   * one with Upscale when Smart upscale is asked for. Nothing runs on a worker
   * without the capability, and nothing falls back to the cloud.
   */
  async function routeGeneration(input, account, pinnedBackend, admission = false) {
    const accountUser = account?.role === "user";
    const workers = listWorkers();
    const kindCapability = input?.kind === "video" ? "video" : "image";
    if (!workers.length && !demoMode)
      return {
        status: 503,
        payload: { ok: false, reason: "no-worker", error: noWorkerMessage(kindCapability) },
      };
    if (
      !accountUser &&
      !(admission && (input?.profileId || input?.model)) &&
      (workers.length === 0 ||
        (workers.length === 1 && workers[0].capabilities.includes(kindCapability)))
    )
      return { backend: currentComfyBackend() };
    try {
      const available = await mediaModels();
      const profile =
        available.models.profiles.find((item) => item.id === input?.profileId) ||
        available.models.profiles.find(
          (item) => item.workflow === input?.workflow && item.model === input?.model,
        );
      if (!profile) {
        if (
          kindCapability === "video" &&
          !workers.some((worker) => worker.capabilities.includes("video"))
        )
          return {
            status: 503,
            payload: { ok: false, reason: "no-worker", error: noWorkerMessage("video") },
          };
        return {
          status: 400,
          payload: {
            ok: false,
            error:
              "This profile is unavailable on its configured backend. Rescan models; the job was not submitted.",
          },
        };
      }
      if (accountUser) {
        const feature =
          (input?.kind || profile.kind) === "video" ? "videoGeneration" : "imageGeneration";
        if (!mayUseGenerationProfile(account, profile) || !mayUseFeature(account, feature))
          return {
            status: 403,
            payload: {
              ok: false,
              error: "This account cannot use the selected generation profile.",
            },
          };
        if (Array.isArray(input?.loras) && input.loras.length && !mayUseFeature(account, "loras"))
          return {
            status: 403,
            payload: { ok: false, error: "LoRAs are not enabled for this account." },
          };
        const hasReference = Boolean(
          input?.startImage || input?.startImageId || input?.referenceAssets?.length,
        );
        if (
          hasReference &&
          !mayUseFeature(
            account,
            feature === "videoGeneration" ? "videoReferences" : "imageReferences",
          )
        )
          return {
            status: 403,
            payload: { ok: false, error: "References are not enabled for this account." },
          };
      }
      if (demoMode && !workers.length) return { backend: currentComfyBackend() };
      const worker = pinnedBackend
        ? workerById(pinnedBackend)
        : routeProfile(profile, { prefers: input?.autoUpscale ? ["upscale"] : [] });
      if (!worker)
        return {
          status: 503,
          payload: { ok: false, error: "The selected worker is no longer configured." },
        };
      if (!workerHas(worker.id, capabilityForProfile(profile)))
        return {
          status: 503,
          payload: {
            ok: false,
            reason: "no-worker",
            error: noWorkerMessage(capabilityForProfile(profile)),
          },
        };
      return {
        backend: worker.id,
        profile,
        offline:
          available.models.workers?.find((item) => item.id === worker.id)?.available === false,
      };
    } catch (error) {
      return {
        status: 503,
        payload: {
          ok: false,
          ...(error?.noWorker ? { reason: "no-worker" } : {}),
          error: error.message,
        },
      };
    }
  }

  async function dispatchGenerate(req, res) {
    const routed = await routeGeneration(req.body, req.studioAccount, req.studioQueueBackend);
    if (routed.payload) return res.status(routed.status).json(routed.payload);
    return withComfyBackend(routed.backend, () => generateOnBackend(req, res));
  }

  async function prepareGenerationBody(input) {
    let body;
    let isMockJob = false;
    let context = null;
    try {
      context = await loadComfyContext();
    } catch (error) {
      // Placeholder generations are only for agent and UI testing without a GPU.
      if (!demoMode) {
        return {
          status: 503,
          payload: {
            ok: false,
            restarting: isDefaultBackend() && comfyRestarting(),
            error: comfyDownMessage(error?.message),
          },
        };
      }
    }
    if (context) {
      try {
        // Read each requested LoRA's family first (a worker's files answer over HTTP), so validation
        // refuses one trained for another model instead of applying it.
        const requested = (Array.isArray(input?.loras) ? input.loras : [])
          .filter(
            (item) => item && item.enabled !== false && typeof item.name === "string" && item.name,
          )
          .map((item) => item.name);
        if (requested.length) await loraInfos(requested.slice(0, 32)).catch(() => null);
        body = sanitizeGenerateBody(input, context.info, context.stats);
        const enabledLoras = (body.loras || []).filter((item) => item.enabled !== false);
        if (enabledLoras.length) {
          const issue = optionalLoraIssue(
            enabledLoras,
            await loraInfos(enabledLoras.map((item) => item.name)),
          );
          if (issue) throw new Error(issue);
        }
      } catch (error) {
        return { status: 400, payload: { ok: false, error: error.message } };
      }
    } else {
      const prompt = String(input?.prompt || "").trim();
      if (!prompt) {
        return { status: 400, payload: { ok: false, error: "Enter a prompt." } };
      }
      isMockJob = true;
      body = {
        kind: input?.kind === "video" ? "video" : "image",
        prompt,
        negative: String(input?.negative || ""),
        model: String(input?.model || "flux1-schnell.safetensors"),
        profileId: String(input?.profileId || ""),
        width: Number(input?.width || 1024),
        height: Number(input?.height || 1024),
        steps: Number(input?.steps || 4),
        cfg: Number(input?.cfg || 1),
        count: Number(input?.count || 1),
        ...(input?.variationCount !== undefined
          ? {
              variationCount: Math.max(
                1,
                Math.min(8, Math.round(Number(input.variationCount) || 1)),
              ),
            }
          : {}),
        sampler: String(input?.sampler || "euler"),
        scheduler: String(input?.scheduler || "simple"),
        seed: String(input?.seed || ""),
        startImageId: String(input?.startImageId || ""),
        startImageName: String(input?.startImageName || ""),
      };
    }
    return { body, isMockJob };
  }

  async function generateOnBackend(req, res) {
    const duplicateId = String(req.body?.clientJobId || "").replace(/[^\w-]/g, "");
    const existing = duplicateId && jobs.get(duplicateId);
    // In account mode a job ID belongs to one owner for good: a reused ID must never touch
    // another account's live job or saved outputs, and the answer must not reveal which.
    if (duplicateId && req.studioAccount) {
      const ownerId = ownerIdForRequest(req);
      const foreign =
        (existing && (existing.ownerId || "") !== ownerId) ||
        gallery.some((item) => item.jobId === duplicateId && (item.ownerId || "") !== ownerId);
      if (foreign)
        return res.status(409).json({ ok: false, error: "That generation ID is already in use." });
    }
    if (existing) {
      return res.json({
        jobId: duplicateId,
        items: existing.items || existing.outputs || [],
        revision: galleryRevisionValue(),
      });
    }
    const prepared = await prepareGenerationBody(req.body);
    if (prepared.payload) return res.status(prepared.status).json(prepared.payload);
    let { body, isMockJob } = prepared;
    body.comfyBackend = currentComfyBackend();
    body.ownerId = ownerIdForRequest(req);
    // What the prompt assistant did for this run (preset, chosen LoRAs), for Details; only with the feature.
    const assistant =
      !req.studioAccount || mayUseFeature(req.studioAccount, "promptAssistant")
        ? assistantRecord(req.body?.assistant, body.loras)
        : null;
    if (assistant) body.assistant = assistant;
    else delete body.assistant;
    // The chat conversation that asked for it (Studio MCP), so the gallery can link back to it.
    const chat = storedChatRecord(req.body?.chat);
    if (chat) body.chat = chat;
    else delete body.chat;
    // Smart upscale: the run's images upscale at this effort as part of the run itself (smartUpscalePrepare).
    const autoUpscale = req.body?.autoUpscale;
    // Only a worker with Upscale runs it as part of the run; elsewhere the run goes ahead at its own size.
    body.autoUpscale =
      body.kind === "image" &&
      upscaleQualities.includes(autoUpscale?.quality) &&
      (demoMode || workerHas(body.comfyBackend, "upscale"))
        ? {
            quality: autoUpscale.quality,
            faceDetail: Boolean(autoUpscale.faceDetail),
            ...(upscaleTargets.includes(Number(autoUpscale.target))
              ? { target: Number(autoUpscale.target) }
              : {}),
          }
        : null;
    if (!req.studioAccount || mayUseFeature(req.studioAccount, "promptHistory"))
      try {
        recordPrompt(body.prompt, "positive", body.ownerId);
        recordPrompt(body.negative, "negative", body.ownerId);
      } catch {
        /* a run matters more than its history */
      }
    // An older page (or a draft restored from before the reference library) can
    // send only the image's id; treat it as the reference instead of losing it.
    if (!isMockJob && !body.referenceAssets?.length && body.startImageId && !body.startImage) {
      // Not a library id (an old start-image upload): keep the legacy path for it.
      body.referenceAssets = await stageReferenceAssets(
        req,
        [{ slot: "reference", assetId: body.startImageId }],
        { unique: Boolean(body.ownerId), generation: body },
      ).catch(() => []);
    }
    if (
      !isMockJob &&
      body.referenceAssets?.length &&
      !body.referenceAssets.every((item) => item.comfyName)
    ) {
      try {
        body.referenceAssets = await stageReferenceAssets(req, body.referenceAssets, {
          unique: Boolean(body.ownerId),
          generation: body,
        });
        body.startImageId ||= body.referenceAssets[0]?.assetId || "";
        body.startImageName ||= body.referenceAssets[0]?.name || "";
      } catch (error) {
        res.status(400).json({ ok: false, error: error.message });
        return;
      }
    }
    // A painted mask becomes a crop, its masks and where to stitch them back (inpaint.js).
    // The mask itself goes no further: it is never stored with the run.
    if (body.inpaint) {
      try {
        body.inpaint = isMockJob ? null : await prepareInpaint(req, body);
      } catch (error) {
        await forgetComfyRun({
          inputNames: (body.referenceAssets || [])
            .filter((item) => item.temporary)
            .map((item) => item.comfyName),
        });
        res.status(400).json({ ok: false, error: error.message });
        return;
      }
    }
    // An empty painted mask falls back to a normal run, so apply normal sizing too.
    if (body.inpaint?.box) {
      const { box, image, work } = body.inpaint;
      console.log(
        `[Studio] Inpaint: repainting ${box.width}×${box.height} at ${box.x},${box.y} of ${image?.width}×${image?.height}, sampled at ${work.width}×${work.height}, strength ${body.inpaint.strength}`,
      );
    }
    // Said back to the page: a mask was sent but nothing in it was painted, so this runs as a plain edit.
    const inpaintSkipped = Boolean(!isMockJob && req.body?.inpaint?.mask && !body.inpaint);
    if (!isMockJob && req.body?.inpaint && !body.inpaint && body.referenceAssets?.length) {
      try {
        const [first, ...others] = body.referenceAssets;
        const [replacement] = await stageReferenceAssets(req, [first], {
          unique: Boolean(body.ownerId),
          generation: body,
        });
        if (first.temporary) await forgetComfyRun({ inputNames: [first.comfyName] });
        body.referenceAssets = [replacement, ...others];
      } catch (error) {
        await forgetComfyRun({
          inputNames: (body.referenceAssets || [])
            .filter((item) => item.temporary)
            .map((item) => item.comfyName),
        });
        res.status(400).json({ ok: false, error: error.message });
        return;
      }
    }
    // Plain img2img samples at the staged image's size, irrespective of the empty latent controls.
    const startSize = body.referenceAssets?.[0];
    const inputFamily = families[body.family];
    if (!body.inpaint && inputFamily?.img2img && !inputFamily.references && startSize?.width) {
      body.requestedSize = { width: body.width, height: body.height };
      body.width = startSize.width;
      body.height = startSize.height;
    }
    if (
      body.autoUpscale &&
      dropsAutoUpscale({
        inpaint: body.inpaint,
        referencesFamily: inputFamily?.references,
        hasReference: Boolean(startSize),
        referenceRole: body.referenceRole,
      })
    )
      body.autoUpscale = null;
    // Every image this run handed ComfyUI; temporary resized copies go when it ends.
    const staged = (body.referenceAssets || []).filter((item) => item.comfyName);
    body.stagedInputNames = [
      ...staged.map((item) => item.comfyName),
      ...inpaintInputNames(body.inpaint),
    ];
    body.temporaryInputNames = [
      ...(body.temporaryInputNames || []),
      ...staged.filter((item) => item.temporary).map((item) => item.comfyName),
    ];
    // A random seed is drawn here rather than inside the graph, so the gallery
    // records the number that actually ran and the image can be made again.
    if (!/^\d+$/.test(String(body.seed ?? "").trim())) {
      body.seed = String(crypto.randomInt(1, 2 ** 31));
      body.seedRandom = true;
    }
    const clientJobId = String(req.body?.clientJobId || "").replace(/[^\w-]/g, "");
    const id = clientJobId || crypto.randomUUID();
    body.clientJobId = id;
    body.createdAt = new Date().toISOString();
    body.startedAt = Date.now();
    const items = makePendingItems(id, body);
    markWorkflowUsed(body.profileId || body.model || body.workflow || "");
    setGallery(dedupeGallery([...items, ...gallery]).slice(0, galleryLimit));
    jobs.set(id, {
      status: "queued",
      ownerId: body.ownerId || undefined,
      comfyBackend: body.comfyBackend,
      kind: body.kind,
      prompt: body.prompt,
      outputs: [],
      items,
      startedAt: body.startedAt,
    });
    res.json({
      jobId: id,
      items,
      revision: galleryRevisionValue(),
      ...(inpaintSkipped
        ? {
            notice:
              "Nothing painted showed up in the mask, so this ran as a normal edit of the whole picture.",
          }
        : {}),
    });
    if (isMockJob) {
      setTimeout(() => runMockJob(id, body), 0);
    } else {
      setTimeout(
        () =>
          runJob(id, body, {
            prepare: body.autoUpscale ? (graph) => smartUpscalePrepare(graph, body) : null,
          }).catch(() => null),
        0,
      );
    }
  }

  /**
   * Smart upscale (2K / 4K in the size menu) goes into the run's own graph, so
   * a run and its upscale are one ComfyUI job (run-upscale.js). When ComfyUI's
   * node list is out of reach the run still goes ahead, without the upscale.
   */
  async function smartUpscalePrepare(graph, body) {
    const { info } = await loadComfyContext().catch(() => ({ info: null }));
    if (!info)
      return {
        skipped: "Smart upscale couldn’t check ComfyUI’s nodes",
        quality: body.autoUpscale?.quality,
      };
    const customWorkflow = String(body.model || "").startsWith("custom:")
      ? getCustomWorkflow(body.model)
      : null;
    return planRunUpscale(graph, body, info, customWorkflow);
  }
  return {
    generate,
    setAdmission(handler) {
      admission = handler;
    },
    async validateInput(input, account) {
      const routed = await routeGeneration(input, account, input?.backendId, true);
      if (routed.payload) return routed;
      if (routed.offline) {
        if (!String(input?.prompt || "").trim())
          return { status: 400, payload: { ok: false, error: "Enter a prompt." } };
        if (input.kind && input.kind !== routed.profile.kind)
          return {
            status: 400,
            payload: { ok: false, error: "The selected profile does not support this media kind." },
          };
        if (input.model && input.model !== routed.profile.model)
          return {
            status: 400,
            payload: {
              ok: false,
              error: "The requested model does not match the selected profile.",
            },
          };
        for (const [field, ceiling] of Object.entries({
          count: 4096,
          width: 16384,
          height: 16384,
          steps: 10000,
          frames: 16384,
          fps: 120,
          variationCount: 8,
        })) {
          const maximum = Math.min(
            Number(routed.profile.constraints?.[field]?.max) || ceiling,
            ceiling,
          );
          const minimum = Math.max(Number(routed.profile.constraints?.[field]?.min) || 1, 1);
          if (
            input[field] !== undefined &&
            (!Number.isFinite(Number(input[field])) ||
              Number(input[field]) < minimum ||
              Number(input[field]) > maximum)
          )
            return {
              status: 400,
              payload: { ok: false, error: `${field} must be between ${minimum} and ${maximum}.` },
            };
        }
        const references = input.referenceAssets || [];
        if (
          !Array.isArray(references) ||
          references.some(
            (reference) => !reference || !referenceExistsForAccount(account, reference.assetId),
          )
        )
          return {
            status: 400,
            payload: {
              ok: false,
              error: "Choose reference images belonging to this account.",
            },
          };
        const start = input.startImageId || input.startImage;
        if (start && !referenceExistsForAccount(account, start))
          return {
            status: 400,
            payload: { ok: false, error: "The start image does not belong to this account." },
          };
        if (routed.profile.capabilities?.startImageRequired && !references.length && !start)
          return {
            status: 400,
            payload: { ok: false, error: "A reference image is required for this workflow." },
          };
        try {
          validateReferenceSlots(references, routed.profile, input);
        } catch (error) {
          return { status: 400, payload: { ok: false, error: error.message } };
        }
        return { status: 200, payload: { ok: true, backend: routed.backend, waiting: true } };
      }
      return withComfyBackend(routed.backend, async () => {
        const prepared = await prepareGenerationBody(input);
        return prepared.payload
          ? prepared
          : { status: 200, payload: { ok: true, backend: routed.backend } };
      });
    },
  };
}
