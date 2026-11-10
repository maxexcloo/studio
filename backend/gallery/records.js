// Gallery records built from a run: its pending tiles, recorded settings and what ComfyUI's history
// says it made. Pure functions, so code that only builds records never loads the gallery (store.js).
import { keptTriggers } from "../lora/prompts.js";
import { videoPattern } from "../media-paths.js";
import { defaultWorkerId } from "../workers.js";
import { hasReferenceImage } from "../workflow-modes.js";

export function promptTitle(text = "") {
  const oneLine = String(text).replace(/\s+/g, " ").trim();
  return oneLine.length > 68 ? `${oneLine.slice(0, 65)}...` : oneLine || "Untitled prompt";
}

export function outputsFrom(history) {
  const urls = [];
  for (const output of Object.values(history.outputs || {})) {
    const imageItems = Array.isArray(output?.images)
      ? output.images.map((item) => [item, "image"])
      : [];
    const videoItems = Array.isArray(output?.videos)
      ? output.videos.map((item) => [item, "video"])
      : [];
    for (const [item, collectionType] of [...imageItems, ...videoItems]) {
      const filename = typeof item?.filename === "string" ? item.filename : "";
      if (!filename) continue;
      const params = new URLSearchParams({
        filename,
        subfolder: item.subfolder || "",
        type: item.type || "output",
      });
      const isVideo = collectionType === "video" || videoPattern.test(filename);
      urls.push({
        url: `/comfy/view?${params}`,
        thumbnailUrl: isVideo ? undefined : `/comfy/thumb?${params}`,
        filename,
        type: isVideo ? "video" : "image",
      });
    }
  }
  return urls;
}

/**
 * What a ComfyUI API graph made: its prompts, size, model and LoRAs, as far as
 * the common nodes tell. The graph comes from ComfyUI's history or from the
 * "prompt" text chunk ComfyUI writes into every PNG it saves.
 */
export function describeComfyGraph(graph = {}) {
  const textNodes = Object.values(graph || {}).filter(
    (node) => node?.class_type === "CLIPTextEncode",
  );
  const prompt = textNodes[0]?.inputs?.text || "";
  const negative = textNodes[1]?.inputs?.text || "";
  const latentNode = Object.values(graph || {}).find(
    (node) =>
      /Latent/i.test(node?.class_type || "") && (node?.inputs?.width || node?.inputs?.height),
  );
  const latent = latentNode?.inputs || {};
  const modelLoader = Object.values(graph || {}).find(
    (node) => node?.inputs?.unet_name || node?.inputs?.ckpt_name,
  );
  const model = modelLoader?.inputs?.unet_name || modelLoader?.inputs?.ckpt_name || "";
  return {
    prompt: typeof prompt === "string" ? prompt : "",
    negative: typeof negative === "string" ? negative : "",
    width: Number(latent.width || 0),
    height: Number(latent.height || 0),
    model: typeof model === "string" ? model : "",
  };
}

/** A stored `assistant` record (assistant-routes.js assistantRecord), kept to its known fields, or null. */
/** The chat that asked for a run: its conversation id, as LibreChat names it (X-Studio-Conversation-Id). */
export function storedChatRecord(value) {
  const id =
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    typeof value.conversationId === "string"
      ? value.conversationId.trim()
      : "";
  return id && id.length <= 256 && !/[\x00-\x1f\x7f]/.test(id) ? { conversationId: id } : null;
}

const shortText = (value, max) =>
  typeof value === "string"
    ? value
        .replace(/[\x00-\x1f\x7f]+/g, " ")
        .trim()
        .slice(0, max)
    : "";

/**
 * The MCP result set a run belongs to (mcp/media.js queue): one generate call's id and title, the
 * client that asked (`source`), the character card it was made with (`character`), and this run's
 * prompt position and its own title (`variation`); null for anything else.
 */
export function storedResultSet(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const id = typeof value.id === "string" && /^[\w-]{1,64}$/.test(value.id) ? value.id : "";
  const title = shortText(value.title, 80);
  if (!id || !title) return null;
  const variation = shortText(value.variation, 80);
  const source = shortText(value.source, 40);
  const characterId =
    typeof value.character?.id === "string" && /^[\w-]{1,64}$/.test(value.character.id)
      ? value.character.id
      : "";
  const characterName = shortText(value.character?.name, 80);
  const index = Number.isInteger(value.index) && value.index >= 0 ? Math.min(value.index, 99) : 0;
  return {
    id,
    title,
    index,
    ...(variation ? { variation } : {}),
    ...(source ? { source } : {}),
    ...(characterId && characterName
      ? { character: { id: characterId, name: characterName } }
      : {}),
  };
}

/**
 * How the queue's writing stage wrote a result's prompt (prompt-stage.js): its kind, text model
 * and thinking; null for anything else.
 */
export function storedWritingRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (!["animate", "request", "dream", "set"].includes(value.kind)) return null;
  const model = typeof value.model === "string" ? value.model.trim().slice(0, 200) : "";
  const thinking = typeof value.thinking === "string" ? value.thinking.trim().slice(0, 20_000) : "";
  return { kind: value.kind, ...(model ? { model } : {}), ...(thinking ? { thinking } : {}) };
}

export function storedAssistantRecord(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof value.preset !== "string" ||
    !/^[a-z-]{1,40}$/.test(value.preset)
  )
    return null;
  const model = typeof value.model === "string" ? value.model.slice(0, 200) : "";
  const loras = Array.isArray(value.lorasSuggested)
    ? value.lorasSuggested.filter((name) => typeof name === "string" && name).slice(0, 8)
    : [];
  return {
    preset: value.preset,
    ...(model ? { model } : {}),
    source: value.source === "chat" ? "chat" : "ui",
    ...(loras.length ? { lorasSuggested: loras } : {}),
  };
}

export function makePendingItems(id, body) {
  const count = body.kind === "image" ? Math.max(1, Math.min(8, Number(body.count || 1))) : 1;
  const title = promptTitle(body.prompt);
  const createdAt = body.createdAt || new Date().toISOString();
  return Array.from({ length: count }, (_, index) => ({
    id: `${id}-${index}`,
    jobId: id,
    index,
    url: "",
    filename: body.kind === "image" && count > 1 ? `${title} ${index + 1}` : title,
    type: body.kind === "video" ? "video" : "image",
    status: "pending",
    prompt: body.prompt || "",
    negative: body.negative || "",
    createdAt,
    // An inpaint result is the whole original picture, whatever size the crop sampled at.
    width: Number(body.inpaint?.image?.width || body.width || 0),
    height: Number(body.inpaint?.image?.height || body.height || 0),
    model: body.model || "",
    settings: generationSettings(body),
    // Written by the prompt assistant: its preset, model and chosen LoRAs (assistant-routes.js assistantRecord).
    ...(body.assistant ? { assistant: body.assistant } : {}),
    // The prompt the queue's writing stage wrote keeps its thinking, under the prompt in Details.
    ...(storedWritingRecord(body.writing) ? { writing: storedWritingRecord(body.writing) } : {}),
    ...(body.chat ? { chat: body.chat } : {}),
    ...(storedResultSet(body.resultSet) ? { resultSet: storedResultSet(body.resultSet) } : {}),
    ...(body.dream ? { dream: body.dream } : {}),
    ...(typeof body.ownerId === "string" && body.ownerId ? { ownerId: body.ownerId } : {}),
  }));
}

export function generationSettings(body) {
  const providerModel = String(body.modelName || body.model || "");
  const grok = providerModel.startsWith("grok-imagine-");
  const settings = {
    comfyBackend: body.comfyBackend || defaultWorkerId(),
    workflow: body.workflow || "",
    profileId: body.profileId || "",
    // The backend a combined profile ran on, so Exact Repeat and Recreate run it there again.
    ...(body.profileBackend ? { profileBackend: String(body.profileBackend) } : {}),
    // The profile's name when it ran, for Details once the profile is renamed or removed.
    ...(body.profileName ? { profileName: String(body.profileName).slice(0, 200) } : {}),
    ...(body.variationCount ? { variationCount: Number(body.variationCount) } : {}),
    ...(body.duration ? { duration: Number(body.duration) } : {}),
    ...(body.resolution ? { resolution: String(body.resolution) } : {}),
    ...(body.resolutionTier ? { resolutionTier: String(body.resolutionTier) } : {}),
    // The prompt as typed, before its LoRAs' trigger words, for reuse in the prompt field.
    ...(body.typedPrompt !== undefined ? { typedPrompt: String(body.typedPrompt) } : {}),
    ...(!grok
      ? {
          steps: Number(body.steps || 0),
          // A distilled profile takes no CFG (backend/validation.js), so none is recorded for it.
          ...(body.cfg !== undefined && body.cfg !== null ? { cfg: Number(body.cfg || 0) } : {}),
          sampler: body.sampler || "",
          scheduler: body.scheduler || "",
        }
      : {}),
    seed: body.seed || "Random",
    ...(body.seedRandom ? { seedRandom: true } : {}),
    // An imported workflow's model is the workflow; this is the file it loaded.
    ...(body.modelName && String(body.model || "").startsWith("custom:")
      ? { modelName: String(body.modelName) }
      : {}),
    textEncoder: body.textEncoder || "",
    ...(Array.isArray(body.encoders) && body.encoders.length > 1
      ? { textEncoders: body.encoders.map(String) }
      : {}),
    vae: body.vae || "",
    clipType: body.clipType || "",
    weightDtype: body.weightDtype || "",
    referenceImageName: body.startImageName || "",
    autoResizeInputs: body.autoResizeInputs !== false,
    ...(body.requestedSize
      ? { width: body.requestedSize.width, height: body.requestedSize.height }
      : {}),
    referenceAssets: Array.isArray(body.referenceAssets)
      ? body.referenceAssets.map(({ slot, assetId, source, name }) => ({
          slot,
          assetId,
          source,
          name,
        }))
      : [],
    // A first reference that only guided: kept, so a retry runs it the same way (Edit is the default).
    ...(body.referenceRole === "reference" &&
    Array.isArray(body.referenceAssets) &&
    body.referenceAssets.length
      ? { referenceRole: "reference" }
      : {}),
    promptPolicy: body.promptPolicy || null,
  };
  const loras = Array.isArray(body.loras)
    ? body.loras
        .filter((item) => item?.enabled !== false && item?.name)
        .slice(0, 8)
        .map((item) => ({
          name: String(item.name || ""),
          enabled: true,
          strength: Number(item.strength ?? 0.7),
          ...keptTriggers(item.triggers),
        }))
    : [];
  if (loras.length) settings.loras = loras;
  if (body.kind === "image") {
    settings.count = Number(body.count || 1);
    if (hasReferenceImage(body) && !providerModel.endsWith(".rad"))
      settings.denoise = Number(body.denoise || 0);
    // Where the painted part sat in the reference; the mask itself is never kept.
    if (body.inpaint?.box) {
      settings.inpaint = {
        box: body.inpaint.box,
        strength: body.inpaint.strength,
        feather: body.inpaint.feather,
      };
      if (body.inpaint.image?.width)
        settings.inpaint.image = {
          width: body.inpaint.image.width,
          height: body.inpaint.image.height,
        };
      // The reference's id lets the live preview draw over the original.
      if (body.inpaint.referenceId) settings.inpaint.referenceId = body.inpaint.referenceId;
    }
    if (body.maskSkipped) settings.maskSkipped = true;
  }
  if (body.kind === "video" && !body.duration) {
    settings.frames = Number(body.frames || 0);
    settings.fps = Number(body.fps || 0);
  }
  return settings;
}
