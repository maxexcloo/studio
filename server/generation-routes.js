import { loraInfos } from './lora-info.js';
import { optionalLoraIssue } from './lora-catalogue.js';
import { configuredBackends, currentComfyBackend, isLocalVideoProfile, withComfyBackend } from "./comfy-backends.js";
import crypto from "node:crypto";
import { demoMode } from './comfy.js';
import { families } from './family-catalog.js';
import { sanitizeGenerateBody } from './validation.js';
import { dedupeGallery, gallery, galleryLimit, makePendingItems, setGallery, galleryRevisionValue } from './gallery-store.js';
import { recordPrompt } from './prompt-history.js';
import { jobs, runJob, runMockJob } from './jobs.js';
import { getCustomWorkflow } from './custom-workflows.js';
import { markWorkflowUsed } from './workflow-catalog.js';
import { encryptionKeyFromRequest, isPrivacyEnabled } from './privacy.js';
import { forgetComfyRun } from './hidden-traces.js';
import { inpaintInputNames, prepareInpaint } from './inpaint.js';
import { stageReferenceAssets } from './reference-assets.js';
import { comfyRestarting } from './comfy-restart.js';
import { upscaleQualities, upscaleTargets } from './upscale.js';
import { dropsAutoUpscale, planRunUpscale } from './run-upscale.js';
import { ownerIdForRequest } from './account-ownership.js';
import { mayUseFeature, mayUseGenerationProfile } from './account-policy.js';
import { configuredAccountJobLimit, reserveAccountJob } from './account-jobs.js';

export function registerGenerationRoutes(app, { loadComfyContext, mediaModels, comfyDownMessage }) {
  const submissions = new Map();
  const accountReservations = new Map();
  const accountJobLimit = configuredAccountJobLimit();
  app.post("/api/generate", async (req, res) => {
    const id = String(req.body?.clientJobId || "").replace(/[^\w-]/g, "");
    // Serialise retries before any asynchronous image staging or backend work.
    // Once acknowledged, the job below answers repeats without staging again.
    let release;
    if (id) {
      while (submissions.has(id)) await submissions.get(id);
      submissions.set(id, new Promise((resolve) => { release = resolve; }));
    }
    let releaseReservation = () => {};
    try {
      if (req.heissAccount?.role === "user" && !(id && jobs.has(id))) {
        const reservation = reserveAccountJob(req.heissAccount.userId, jobs, accountReservations, accountJobLimit);
        if (!reservation.accepted) {
          return res.status(429).json({ ok: false, reason: "job-limit", error: `You can have up to ${accountJobLimit} outstanding jobs.` });
        }
        releaseReservation = reservation.release;
      }
      await dispatchGenerate(req, res);
    } finally {
      releaseReservation();
      if (id) { submissions.delete(id); release(); }
    }
  });

  async function dispatchGenerate(req, res) {
    const accountUser = req.heissAccount?.role === "user";
    if (accountUser && req.body?.privateVault) return res.status(403).json({ ok: false, error: "Private Vault is not available until account storage is separated." });
    if (!accountUser && configuredBackends().length === 1) return generateOnBackend(req, res);
    try {
      const available = await mediaModels();
      const profile = available.models.profiles.find((item) => item.id === req.body?.profileId)
        || available.models.profiles.find((item) => item.workflow === req.body?.workflow && item.model === req.body?.model);
      if (!profile) return res.status(400).json({ ok: false, error: "This profile is unavailable on its configured backend. Rescan models; the job was not submitted." });
      if (accountUser) {
        const feature = (req.body?.kind || profile.kind) === "video" ? "videoGeneration" : "imageGeneration";
        if (!mayUseGenerationProfile(req.heissAccount, profile.id) || !mayUseFeature(req.heissAccount, feature)) {
          return res.status(403).json({ ok: false, error: "This account cannot use the selected generation profile." });
        }
        if (Array.isArray(req.body?.loras) && req.body.loras.length && !mayUseFeature(req.heissAccount, "loras")) {
          return res.status(403).json({ ok: false, error: "LoRAs are not enabled for this account." });
        }
        const hasReference = Boolean(req.body?.startImage || req.body?.startImageId || req.body?.referenceAssets?.length);
        const referenceFeature = feature === "videoGeneration" ? "videoReferences" : "imageReferences";
        if (hasReference && !mayUseFeature(req.heissAccount, referenceFeature)) {
          return res.status(403).json({ ok: false, error: "References are not enabled for this account." });
        }
      }
      if (configuredBackends().length === 1) return generateOnBackend(req, res);
      const backend = isLocalVideoProfile(profile) ? "video" : "primary";
      return await withComfyBackend(backend, () => generateOnBackend(req, res));
    } catch (error) {
      if (!res.headersSent) res.status(503).json({ ok: false, error: error.message });
    }
  }

  async function generateOnBackend(req, res) {
    const requestKey = encryptionKeyFromRequest(req);
    const hidden = Boolean(req.body?.privateVault);
    // Checked before anything reaches ComfyUI, so a Hidden prompt never runs in the open.
    if (hidden && !isPrivacyEnabled()) {
      res.status(400).json({ ok: false, reason: "setup", error: "Set up Hidden before generating into it." });
      return;
    }
    if (hidden && !requestKey) {
      res.status(401).json({ ok: false, locked: true, reason: "locked", error: "Hidden is locked. Unlock it to generate." });
      return;
    }
    const duplicateId = String(req.body?.clientJobId || "").replace(/[^\w-]/g, "");
    const existing = duplicateId && jobs.get(duplicateId);
    // In account mode a job ID belongs to one owner for good: a reused ID must never touch
    // another account's live job or saved outputs, and the answer must not reveal which.
    if (duplicateId && req.heissAccount) {
      const ownerId = ownerIdForRequest(req);
      const foreign = (existing && (existing.ownerId || "") !== ownerId)
        || gallery.some((item) => item.jobId === duplicateId && (item.ownerId || "") !== ownerId);
      if (foreign) return res.status(409).json({ ok: false, error: "That generation ID is already in use." });
    }
    if (existing) {
      if ((hidden && !existing.privateVault) || (existing.privateVault && (!requestKey || (existing.vaultKey && !existing.vaultKey.equals(requestKey))))) {
        return res.status(409).json({ ok: false, error: "That generation ID is already in use." });
      }
      return res.json({ jobId: duplicateId, items: existing.items || existing.outputs || [], hidden: existing.privateVault, revision: galleryRevisionValue() });
    }
    let body;
    let isMockJob = false;
    let context = null;
    try {
      context = await loadComfyContext();
    } catch (error) {
      // Placeholder generations are only for agent and UI testing without a GPU.
      if (!demoMode) {
        res.status(503).json({ ok: false, restarting: comfyRestarting(), error: comfyDownMessage(error?.message) });
        return;
      }
    }
    if (context) {
      try {
        body = sanitizeGenerateBody(req.body, context.info, context.stats);
        const enabledLoras = (body.loras || []).filter((item) => item.enabled !== false);
        if (enabledLoras.length) {
          const issue = optionalLoraIssue(enabledLoras, await loraInfos(enabledLoras.map((item) => item.name)));
          if (issue) throw new Error(issue);
        }
      } catch (error) {
        res.status(400).json({ ok: false, error: error.message });
        return;
      }
    } else {
      const prompt = String(req.body?.prompt || "").trim();
      if (!prompt) {
        res.status(400).json({ error: "Enter a prompt." });
        return;
      }
      isMockJob = true;
      body = {
        kind: req.body?.kind === "video" ? "video" : "image",
        prompt,
        negative: String(req.body?.negative || ""),
        model: String(req.body?.model || "flux1-schnell.safetensors"),
        width: Number(req.body?.width || 1024),
        height: Number(req.body?.height || 1024),
        steps: Number(req.body?.steps || 4),
        cfg: Number(req.body?.cfg || 1),
        count: Number(req.body?.count || 1),
        ...(req.body?.variationCount !== undefined ? { variationCount: Math.max(1, Math.min(8, Math.round(Number(req.body.variationCount) || 1))) } : {}),
        sampler: String(req.body?.sampler || "euler"),
        scheduler: String(req.body?.scheduler || "simple"),
        seed: String(req.body?.seed || ""),
        startImageId: String(req.body?.startImageId || ""),
        startImageName: String(req.body?.startImageName || "")
      };
    }
    // What is made from a Hidden image stays hidden, wherever it was asked for.
    const fromHidden = [...(req.body?.referenceAssets || []).map((item) => item?.assetId), req.body?.startImageId].some((id) => String(id || "").startsWith("vault:"));
    if (fromHidden && !requestKey) {
      res.status(401).json({ ok: false, locked: true, reason: "locked", error: "That reference is in Hidden. Unlock Hidden to use it." });
      return;
    }
    body.comfyBackend = currentComfyBackend();
    body.ownerId = ownerIdForRequest(req);
    body.privateVault = hidden || fromHidden;
    // Smart upscale: the run's images upscale at this effort as part of the run itself (smartUpscalePrepare).
    const autoUpscale = req.body?.autoUpscale;
    body.autoUpscale = body.kind === "image" && upscaleQualities.includes(autoUpscale?.quality)
      ? { quality: autoUpscale.quality, faceDetail: Boolean(autoUpscale.faceDetail), ...(upscaleTargets.includes(Number(autoUpscale.target)) ? { target: Number(autoUpscale.target) } : {}) }
      : null;
    // Recent prompts are the gallery's: nothing made for Hidden is ever written there.
    if (!body.privateVault && (!req.heissAccount || mayUseFeature(req.heissAccount, 'promptHistory'))) try { recordPrompt(body.prompt, "positive", body.ownerId); recordPrompt(body.negative, "negative", body.ownerId); } catch { /* a run matters more than its history */ }
    // An older page (or a draft restored from before the reference library) can
    // send only the image's id; treat it as the reference instead of losing it.
    if (!isMockJob && !body.referenceAssets?.length && body.startImageId && !body.startImage) {
      // Not a library id (an old start-image upload): keep the legacy path for it.
      body.referenceAssets = await stageReferenceAssets(req, [{ slot: "reference", assetId: body.startImageId }], { unique: body.privateVault || Boolean(body.ownerId), generation: body }).catch(() => []);
    }
    if (!isMockJob && body.referenceAssets?.length && !body.referenceAssets.every((item) => item.comfyName)) {
      try {
        body.referenceAssets = await stageReferenceAssets(req, body.referenceAssets, { unique: body.privateVault || Boolean(body.ownerId), generation: body });
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
        await forgetComfyRun({ inputNames: (body.referenceAssets || []).filter((item) => item.temporary).map((item) => item.comfyName) });
        res.status(400).json({ ok: false, error: error.message });
        return;
      }
    }
    // An empty painted mask falls back to a normal run, so apply normal sizing too.
    if (body.inpaint?.box) {
      const { box, image, work } = body.inpaint;
      console.log(`[Studio] Inpaint: repainting ${box.width}×${box.height} at ${box.x},${box.y} of ${image?.width}×${image?.height}, sampled at ${work.width}×${work.height}, strength ${body.inpaint.strength}`);
    }
    // Said back to the page: a mask was sent but nothing in it was painted, so this runs as a plain edit.
    const inpaintSkipped = Boolean(!isMockJob && req.body?.inpaint?.mask && !body.inpaint);
    if (!isMockJob && req.body?.inpaint && !body.inpaint && body.referenceAssets?.length) {
      try {
        const [first, ...others] = body.referenceAssets;
        const [replacement] = await stageReferenceAssets(req, [first], { unique: body.privateVault || Boolean(body.ownerId), generation: body });
        if (first.temporary) await forgetComfyRun({ inputNames: [first.comfyName] });
        body.referenceAssets = [replacement, ...others];
      } catch (error) {
        await forgetComfyRun({ inputNames: (body.referenceAssets || []).filter((item) => item.temporary).map((item) => item.comfyName) });
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
    if (body.autoUpscale && dropsAutoUpscale({ inpaint: body.inpaint, referencesFamily: inputFamily?.references, hasReference: Boolean(startSize), referenceRole: body.referenceRole })) body.autoUpscale = null;
    // Every image this run handed ComfyUI: all of them go after a Hidden run, and
    // after a normal one, temporary resized copies and any Hidden references.
    const staged = (body.referenceAssets || []).filter((item) => item.comfyName);
    const inpaintNames = inpaintInputNames(body.inpaint);
    body.stagedInputNames = [...staged.map((item) => item.comfyName), ...inpaintNames];
    const fromHiddenImage = String(body.referenceAssets?.[0]?.assetId || "").startsWith("vault:");
    body.hiddenInputNames = [
      ...staged.filter((item) => item.temporary || String(item.assetId || "").startsWith("vault:")).map((item) => item.comfyName),
      ...(fromHiddenImage ? inpaintNames : [])
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
    jobs.set(id, { status: "queued", ownerId: body.ownerId || undefined, comfyBackend: body.comfyBackend, kind: body.kind, prompt: body.prompt, outputs: [], items, startedAt: body.startedAt, privateVault: body.privateVault, vaultKey: body.privateVault ? requestKey : null });
    res.json({ jobId: id, items, hidden: body.privateVault, revision: galleryRevisionValue(), ...(inpaintSkipped ? { notice: "Nothing painted showed up in the mask, so this ran as a normal edit of the whole picture." } : {}) });
    if (isMockJob) {
      setTimeout(() => runMockJob(id, body), 0);
    } else {
      setTimeout(() => runJob(id, body, { prepare: body.autoUpscale ? (graph) => smartUpscalePrepare(graph, body) : null }).catch(() => null), 0);
    }
  }

  /**
   * Smart upscale (2K / 4K in the size menu) goes into the run's own graph, so
   * a run and its upscale are one ComfyUI job (run-upscale.js). When ComfyUI's
   * node list is out of reach the run still goes ahead, without the upscale.
   */
  async function smartUpscalePrepare(graph, body) {
    const { info } = await loadComfyContext().catch(() => ({ info: null }));
    if (!info) return { skipped: "Smart upscale couldn’t check ComfyUI’s nodes", quality: body.autoUpscale?.quality };
    const customWorkflow = String(body.model || "").startsWith("custom:") ? getCustomWorkflow(body.model) : null;
    return planRunUpscale(graph, body, info, customWorkflow);
  }
}
