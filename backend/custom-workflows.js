import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { dataDir } from "./gallery-store.js";
import { chainReferenceSlots } from "./reference-chains.js";
import { writeJsonFile } from "./json-store.js";
import { grokEnabled, modelFamilyEnabled } from "./features.js";
import { canonicalProfileId, profileAliasBackend } from "./profile-store.js";
import { profileBackendLabels, sharedProfileFields } from "../shared/profiles.ts";

export { profileBackendLabels, sharedProfileFields };

export const userWorkflowsDir = path.join(dataDir, "workflows");

// Windows keeps these names for devices, with any extension: `con.json` can never be a file.
const windowsReserved = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\.|$)/;

function safeId(value = "") {
  const id =
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || `workflow-${crypto.randomUUID()}`;
  return windowsReserved.test(id) ? id.replace(/^[^.]+/, "$&-1") : id;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function workflowMeta(raw = {}) {
  return raw?.studio || {};
}

function loraStackConfig(meta = {}) {
  const stack = meta.loraStack;
  if (
    !stack ||
    !["rgthree-power-v1", "rgthree-stack-v1", "radiance-tags-v1"].includes(stack.adapter) ||
    !stack.node
  )
    return null;
  return {
    adapter: stack.adapter,
    node: String(stack.node),
    max: Math.max(
      1,
      Math.min(8, Number(stack.max) || (stack.adapter === "rgthree-power-v1" ? 8 : 4)),
    ),
  };
}

function mediaInputsConfig(meta = {}, controls = {}) {
  const raw = Array.isArray(meta.mediaInputs) ? meta.mediaInputs : [];
  const normalized = raw
    .map((item, index) => ({
      id: safeId(item?.id || `reference-${index + 1}`),
      kind: item?.kind === "image" ? "image" : "image",
      label: String(item?.label || (index ? `Reference ${index + 1}` : "Reference image")),
      required: Boolean(item?.required),
      min: Math.max(0, Number(item?.min ?? (item?.required ? 1 : 0)) || 0),
      // Each mapping writes one filename; several references need separate graph inputs.
      max: 1,
      control:
        item?.control?.node && item?.control?.input
          ? { node: String(item.control.node), input: String(item.control.input) }
          : null,
      ...(["start", "end", "reference"].includes(item?.role) ? { role: item.role } : {}),
      ...(item?.follows ? { follows: safeId(item.follows) } : {}),
    }))
    .filter((item) => item.control);
  chainReferenceSlots(normalized);
  if (!normalized.length && controls.startImage?.node && controls.startImage?.input) {
    normalized.push({
      id: "reference",
      kind: "image",
      label: "Reference image",
      required: Boolean(meta.capabilities?.startImageRequired),
      min: meta.capabilities?.startImageRequired ? 1 : 0,
      max: 1,
      control: { node: String(controls.startImage.node), input: String(controls.startImage.input) },
    });
  }
  return normalized;
}

function promptCompositionConfig(meta = {}) {
  const value = meta.promptComposition;
  if (!value || typeof value !== "object") return null;
  return {
    prefix: String(value.prefix || "").slice(0, 1000),
    suffix: String(value.suffix || "").slice(0, 8000),
    policy: String(value.policy || "custom").slice(0, 120),
    version: Math.max(1, Number(value.version || 1)),
  };
}

export function graphFromJson(raw, info = {}) {
  if (raw?.graph && typeof raw.graph === "object") return raw.graph;
  if (Array.isArray(raw?.nodes) && Array.isArray(raw?.links)) return visualWorkflowToApi(raw, info);
  const copy = { ...raw };
  delete copy.studio;
  delete copy.metadata;
  return copy;
}

function schemaInputNames(info, classType) {
  const schema = info?.[classType]?.input || {};
  return [...Object.keys(schema.required || {}), ...Object.keys(schema.optional || {})].filter(
    (name) => !["unique_id", "control_after_generate"].includes(name),
  );
}

function visualWorkflowToApi(raw, info = {}) {
  const links = new Map(
    (raw.links || []).map((link) => [String(link[0]), [String(link[1]), Number(link[2] || 0)]]),
  );
  const graph = {};
  // These nodes exist only for canvas organization and are not part of the API prompt.
  const uiOnly = new Set(["Note", "Reroute", "PrimitiveNode", "NoteNode"]);
  for (const node of raw.nodes) {
    const id = String(node.id);
    const classType = node.type || node.class_type;
    if (!classType) throw new Error(`Visual workflow node ${id} is missing a type.`);
    if (uiOnly.has(classType)) continue;
    const inputs = {};
    for (const input of node.inputs || []) {
      if (input?.link != null && links.has(String(input.link)))
        inputs[input.name] = links.get(String(input.link));
    }
    const names = schemaInputNames(info, classType);
    const linked = new Set(Object.keys(inputs));
    const widgetNames = names.filter((name) => !linked.has(name));
    const namedWidgets =
      node.widgets_values_named && typeof node.widgets_values_named === "object"
        ? node.widgets_values_named
        : null;
    if (namedWidgets) {
      for (const name of widgetNames) {
        if (Object.prototype.hasOwnProperty.call(namedWidgets, name))
          inputs[name] = namedWidgets[name];
      }
    } else {
      const widgets = Array.isArray(node.widgets_values) ? node.widgets_values : [];
      if (widgets.length > widgetNames.length)
        throw new Error(
          `Node ${id} (${classType}) has more widget values than ComfyUI expects. Export the workflow again, or reconnect ComfyUI, then import it.`,
        );
      widgets.forEach((value, index) => {
        inputs[widgetNames[index]] = value;
      });
    }
    // The canvas title ("Positive", "Refiner") is how people know a node; keep it for the import review.
    const meta = node._meta || (node.title ? { title: String(node.title) } : null);
    graph[id] = { class_type: classType, inputs, ...(meta ? { _meta: meta } : {}) };
  }
  return graph;
}

export function detectWorkflowFormat(raw) {
  if (Array.isArray(raw?.nodes) && Array.isArray(raw?.links)) return "comfyui-visual";
  if (raw?.prompt && typeof raw.prompt === "object") return "comfyui-api-wrapper";
  if (raw && typeof raw === "object" && Object.values(raw).some((node) => node?.class_type))
    return "comfyui-api";
  return "unsupported";
}

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
/** A combined profile's backend ids, in file order; empty for a profile with one graph. */
export const backendIdsOf = (raw) =>
  isRecord(raw?.studio?.backends) ? Object.keys(raw.studio.backends) : [];

/**
 * The single-graph profile a combined one runs on `requested` (else its `backend`, else its first):
 * the shared fields with that backend's block over them. A profile with one graph is returned as is.
 */
export function profileOnBackend(raw, requested = "") {
  const ids = backendIdsOf(raw);
  if (!ids.length) return { raw, backend: "", backendIds: [] };
  const { backends, backend: chosen, ...shared } = raw.studio;
  const backend = ids.includes(requested) ? requested : ids.includes(chosen) ? chosen : ids[0];
  const { graph, ...own } = isRecord(backends[backend]) ? backends[backend] : {};
  return { raw: { graph: graph || {}, studio: { ...shared, ...own } }, backend, backendIds: ids };
}

/** A workflow record (metadataFromJson) on another of its backends; the record itself when it already runs there or has one graph. */
export function workflowOnBackend(workflow, backend) {
  if (!workflow?.backendIds?.includes(backend) || workflow.backend === backend || !workflow.raw)
    return workflow;
  const { raw, path: file, source, aiDrafted } = workflow;
  return {
    ...metadataFromJson(raw, file, { backend }),
    source,
    raw,
    ...(aiDrafted ? { aiDrafted } : {}),
  };
}

export function metadataFromJson(raw, file, { backend: requested = "" } = {}) {
  if (backendIdsOf(raw).length) {
    const { raw: single, backend, backendIds } = profileOnBackend(raw, requested);
    return { ...metadataFromJson(single, file), backend, backendIds };
  }
  const meta = workflowMeta(raw);
  const id = safeId(meta.id || path.basename(file || "", path.extname(file || "")));
  const graph = graphFromJson(raw);
  const controls = meta.controls || {};
  const loraStack = loraStackConfig(meta);
  const mediaInputs = mediaInputsConfig(meta, controls);
  const promptComposition = promptCompositionConfig(meta);
  const graphDefault = (key) => {
    const mapping = controls[key];
    return mapping?.node && mapping?.input
      ? graph?.[mapping.node]?.inputs?.[mapping.input]
      : undefined;
  };
  const imageModes = Object.fromEntries(
    Object.entries(meta.imageModes || {}).map(([mode, variant]) => [
      mode,
      metadataFromJson(
        {
          graph: variant.graph || graph,
          studio: {
            ...meta,
            ...variant,
            capabilities: variant.capabilities || {},
            prompting: variant.prompting,
            imageModes: undefined,
          },
        },
        file,
      ),
    ]),
  );
  const classes = [
    ...new Set(
      [graph, ...Object.values(imageModes).map((mode) => mode.graph)]
        .flatMap((value) => Object.values(value || {}).map((node) => node?.class_type))
        .filter(Boolean),
    ),
  ];
  return {
    id,
    profileId: `custom:${id}`,
    name: meta.name || id,
    description: meta.description || "Custom ComfyUI workflow",
    ...(meta.prompting && typeof meta.prompting === "object" && !Array.isArray(meta.prompting)
      ? { prompting: structuredClone(meta.prompting) }
      : {}),
    kind: meta.kind === "video" ? "video" : "image",
    family: meta.family || "custom",
    // Adult content: access profiles without NSFW Models never see it.
    ...(meta.nsfw === true ? { nsfw: true } : {}),
    recipe: meta.recipe,
    graph,
    controls,
    options: meta.options || {},
    loraStack,
    imageModes,
    mediaInputs,
    metadataWarnings: (Array.isArray(meta.mediaInputs) ? meta.mediaInputs : [])
      .filter((input) => input?.control?.node && input?.control?.input && Number(input.max) > 1)
      .map(
        (input) =>
          `Reference input ${input.label || input.id} maps one image filename. Use separate mapped inputs for multiple references.`,
      ),
    promptComposition,
    requiredNodes:
      Array.isArray(meta.requiredNodes) && meta.requiredNodes.length ? meta.requiredNodes : classes,
    defaults: {
      model: graphDefault("model") || "",
      textEncoder: graphDefault("textEncoder") || "",
      vae: graphDefault("vae") || "",
      clipType: graphDefault("clipType") || "",
      weightDtype: graphDefault("weightDtype") || "",
      sampler: graphDefault("sampler") || "",
      scheduler: graphDefault("scheduler") || "",
      width: graphDefault("width") || undefined,
      height: graphDefault("height") || undefined,
      steps: graphDefault("steps") || undefined,
      cfg: graphDefault("cfg") || undefined,
      denoise: graphDefault("denoise") || undefined,
      count: graphDefault("count") || undefined,
      frames: graphDefault("frames") || undefined,
      fps: graphDefault("fps") || undefined,
      duration: graphDefault("duration") || undefined,
      resolution: graphDefault("resolution") || "",
      ...(meta.defaults || {}),
    },
    aspectRatios: meta.aspectRatios || meta.aspects || [],
    aspectPolicy: meta.aspectPolicy === "reference" ? "reference" : "manual",
    capabilities: {
      cfg: Boolean(controls.cfg),
      lora: Boolean(loraStack),
      sampler: Boolean(controls.sampler),
      scheduler: Boolean(controls.scheduler),
      seed: Boolean(controls.seed),
      steps: Boolean(controls.steps),
      negativePrompt: Boolean(controls.negative),
      variations: Boolean(controls.count),
      frames: Boolean(controls.frames),
      fps: Boolean(controls.fps),
      duration: Boolean(controls.duration),
      resolution: Boolean(controls.resolution),
      startImage: mediaInputs.length > 0 || Boolean(controls.startImage),
      startImageRequired: mediaInputs.some((item) => item.required || item.min > 0),
      imageToImage: meta.capabilities?.imageToImage === true || mediaInputs.length > 0,
      denoise: Boolean(controls.denoise),
      textEncoder: Boolean(controls.textEncoder),
      vae: Boolean(controls.vae),
      clipType: Boolean(controls.clipType),
      weightDtype: Boolean(controls.weightDtype),
      ...(meta.capabilities || {}),
    },
    path: file || "",
  };
}

export function validateGraph(graph) {
  if (!graph || typeof graph !== "object" || !Object.keys(graph).length)
    throw new Error("This file has no ComfyUI workflow in it.");
  for (const [id, node] of Object.entries(graph)) {
    if (!node?.class_type) throw new Error(`Workflow node ${id} is missing class_type.`);
    for (const value of Object.values(node.inputs || {})) {
      if (Array.isArray(value) && typeof value[0] === "string" && !graph[value[0]]) {
        throw new Error(`Workflow node ${id} references missing node ${value[0]}.`);
      }
    }
  }
}

const loaderOptionKeys = {
  UNETLoader: ["unet_name"],
  CheckpointLoaderSimple: ["ckpt_name"],
  CLIPLoader: ["clip_name"],
  VAELoader: ["vae_name"],
  UpscaleModelLoader: ["model_name"],
};

/** What each loader reads, in words, and the models subfolder ComfyUI reads it from. */
const loaderKinds = {
  UNETLoader: ["diffusion model", "diffusion_models"],
  CheckpointLoaderSimple: ["checkpoint", "checkpoints"],
  CLIPLoader: ["text encoder", "text_encoders"],
  VAELoader: ["VAE", "vae"],
  UpscaleModelLoader: ["upscale model", "upscale_models"],
};

function schemaOptions(info, classType, input) {
  const definition = info?.[classType]?.input?.required?.[input];
  if (!Array.isArray(definition)) return [];
  if (Array.isArray(definition[0])) return definition[0];
  if (Array.isArray(definition[1]?.options)) return definition[1].options;
  return [];
}

/** Every model file the graph's loaders name that ComfyUI does not list: { file, kind, folder, classType }, once each. */
export function workflowMissingFiles(workflow, info = {}) {
  const found = new Map();
  for (const node of Object.values(workflow?.graph || {})) {
    const keys = loaderOptionKeys[node?.class_type] || [];
    if (!keys.length || !info?.[node.class_type]) continue;
    for (const key of keys) {
      const selected = node.inputs?.[key];
      if (!selected || typeof selected !== "string") continue;
      if (schemaOptions(info, node.class_type, key).includes(selected)) continue;
      const [kind, folder] = loaderKinds[node.class_type] || ["file", "models"];
      found.set(`${folder}/${selected}`, {
        file: selected,
        kind,
        folder,
        classType: node.class_type,
      });
    }
  }
  return [...found.values()];
}

export function workflowOptionIssues(workflow, info = {}) {
  // Said as the file and where it goes; node ids mean nothing outside the graph editor.
  return workflowMissingFiles(workflow, info).map(
    ({ file, kind, folder }) =>
      `Missing ${kind}: ${file}. Put it in ComfyUI’s models/${folder} folder.`,
  );
}

export function allCustomWorkflowRecords({ dedupe = true } = {}) {
  const dir = userWorkflowsDir;
  const source = "custom";
  const items = [];
  // profile-store.js keeps each Studio profile's version and AI-Drafted marker beside them.
  const versions = readJson(path.join(dir, ".studio-meta.json")) || {};
  // Dotfiles beside the profiles (.studio-edits.json, .studio-meta.json) are Studio's records, not workflows.
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter((name) => name.endsWith(".json") && !name.startsWith("."))
    : [];
  for (const file of files) {
    const fullPath = path.join(dir, file);
    const raw = readJson(fullPath);
    if (!raw) {
      items.push({
        id: safeId(path.basename(file, ".json")),
        profileId: `custom:${safeId(path.basename(file, ".json"))}`,
        name: path.basename(file, ".json"),
        description: "This file isn’t valid JSON.",
        kind: "image",
        family: "custom",
        graph: {},
        controls: {},
        requiredNodes: [],
        defaults: {},
        capabilities: {},
        path: fullPath,
        source,
        parseError: "Invalid JSON",
      });
      continue;
    }
    try {
      const drafted = versions[path.basename(file, ".json")]?.aiDrafted === true;
      items.push({
        ...metadataFromJson(raw, fullPath),
        source,
        raw,
        ...(drafted ? { aiDrafted: true } : {}),
      });
    } catch (error) {
      items.push({
        id: safeId(path.basename(file, ".json")),
        profileId: `custom:${safeId(path.basename(file, ".json"))}`,
        name: path.basename(file, ".json"),
        description: error.message || "Couldn’t read this workflow.",
        kind: "image",
        family: "custom",
        graph: {},
        controls: {},
        requiredNodes: [],
        defaults: {},
        capabilities: {},
        path: fullPath,
        source,
        parseError: error.message,
      });
    }
  }
  const allowed = items.filter(
    (workflow) =>
      modelFamilyEnabled(workflow.family, workflow.defaults?.model) &&
      Object.values(workflow.graph || {}).every((node) =>
        modelFamilyEnabled("", node.inputs?.unet_name),
      ) &&
      (grokEnabled || !usesGrokMedia(workflow)),
  );
  if (!dedupe) return allowed;
  const seen = new Set();
  return allowed.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function withinWorkflowRoot(file) {
  const resolved = path.resolve(file);
  const base = path.resolve(userWorkflowsDir);
  return resolved === base || resolved.startsWith(`${base}${path.sep}`);
}

/** Grok runs at its provider (providers/profiles.ts), never on a ComfyUI worker. */
export const usesGrokMedia = (workflow) =>
  Object.values(workflow.graph || {}).some((node) => node.class_type === "GrokMedia");

export function loadCustomWorkflows() {
  return allCustomWorkflowRecords().filter((workflow) => {
    try {
      validateGraph(workflow.graph);
      return workflow.graph && Object.keys(workflow.graph).length;
    } catch {
      return false;
    }
  });
}

/**
 * The workflow a profile id names (merged ids resolve), on `backend` when it is one of the
 * profile's; an old per-backend id of a combined profile runs on its own backend.
 */
export function getCustomWorkflow(requested, backend = profileAliasBackend(requested)) {
  const profileId = canonicalProfileId(requested);
  const workflow = loadCustomWorkflows().find(
    (workflow) =>
      workflow.profileId === profileId ||
      workflow.id === profileId ||
      `custom:${workflow.id}` === profileId,
  );
  return workflow ? workflowOnBackend(workflow, backend) : null;
}

export function saveImportedWorkflow(raw, meta = {}) {
  const mergedMeta = {
    ...workflowMeta(raw),
    ...meta,
  };
  const { studio: _block, ...rest } = raw;
  const profile = { studio: mergedMeta, ...rest };
  const workflow = metadataFromJson(profile);
  mergedMeta.id = workflow.id;
  workflow.profileId = `custom:${workflow.id}`;
  fs.mkdirSync(userWorkflowsDir, { recursive: true });
  const file = path.join(userWorkflowsDir, `${workflow.id}.json`);
  writeJsonFile(file, profile);
  return { ...workflow, path: file };
}

/**
 * Removes every file backing an id. A record's filename can differ from its id,
 * so resolve real paths rather than guessing `<id>.json`.
 */
export function deleteImportedWorkflow(id) {
  const safe = safeId(id);
  const targets = allCustomWorkflowRecords({ dedupe: false }).filter(
    (record) => record.id === safe && record.path && withinWorkflowRoot(record.path),
  );
  const removed = [];
  for (const record of targets) {
    if (!fs.existsSync(record.path)) continue;
    fs.unlinkSync(record.path);
    removed.push(record.path);
  }
  if (!removed.length) throw new Error("Workflow file was not found.");
  return { ok: true, id: safe, removed };
}

function nodeInputsForClass(classType = "") {
  if (/KSampler/i.test(classType))
    return ["seed", "steps", "cfg", "sampler_name", "scheduler", "denoise"];
  if (/TextEncode/i.test(classType)) return ["text"];
  if (/Latent|Image/i.test(classType)) return ["width", "height", "batch_size"];
  if (/Video/i.test(classType)) return ["length", "fps", "width", "height"];
  return [];
}

export function detectWorkflowMetadata(raw, fallbackName = "", _info = {}) {
  const existing = workflowMeta(raw);
  const graph = graphFromJson(raw);
  const nodes = Object.entries(graph || {}).map(([id, node]) => ({
    id,
    classType: node?.class_type || "",
    title: String(node?._meta?.title || ""),
    inputs: node?.inputs || {},
  }));
  const textNodes = nodes.filter(
    (node) =>
      /TextEncode/i.test(node.classType) && ("text" in node.inputs || "prompt" in node.inputs),
  );
  const latentNode = nodes.find(
    (node) => /Latent/i.test(node.classType) && ("width" in node.inputs || "height" in node.inputs),
  );
  const samplerNode = nodes.find((node) => /Sampler/i.test(node.classType));
  const videoNode = nodes.find(
    (node) => /Video/i.test(node.classType) && ("length" in node.inputs || "fps" in node.inputs),
  );
  const imageLoader = nodes.find(
    (node) => node.classType === "LoadImage" && "image" in node.inputs,
  );
  const controls = {
    ...(existing.controls || {}),
  };
  // Connections the workflow didn't declare itself: found by node type and order, worth a second look.
  const guessed = [];
  const set = (key, node, input) => {
    if (!controls[key] && node && input && input in node.inputs) {
      controls[key] = { node: node.id, input };
      guessed.push(key);
    }
  };
  set("prompt", textNodes[0], "text" in (textNodes[0]?.inputs || {}) ? "text" : "prompt");
  set("negative", textNodes[1], "text" in (textNodes[1]?.inputs || {}) ? "text" : "prompt");
  set("width", latentNode || videoNode, "width");
  set("height", latentNode || videoNode, "height");
  set("count", latentNode, "batch_size");
  set("seed", samplerNode, "seed");
  set("steps", samplerNode, "steps");
  set("cfg", samplerNode, "cfg");
  set("sampler", samplerNode, "sampler_name");
  set("scheduler", samplerNode, "scheduler");
  set("denoise", samplerNode, "denoise");
  set("frames", videoNode, "length");
  set("fps", videoNode, "fps");
  set("startImage", imageLoader, "image");
  const hasVideo = nodes.some((node) => /Video|VHS|Wan/i.test(node.classType));
  const id = safeId(existing.id || fallbackName || "imported-workflow");
  return {
    id,
    name: existing.name || fallbackName || id,
    description: existing.description || "Imported ComfyUI workflow",
    kind: existing.kind === "video" || hasVideo ? "video" : "image",
    family: existing.family || "custom",
    controls,
    guessed,
    loraStack: existing.loraStack || null,
    defaults: existing.defaults || {},
    capabilities: {
      ...(existing.capabilities || {}),
      ...(controls.startImage ? { startImage: true, imageToImage: true } : {}),
    },
    mediaInputs: Array.isArray(existing.mediaInputs)
      ? existing.mediaInputs
      : controls.startImage
        ? [
            {
              id: "reference",
              kind: "image",
              label: "Reference image",
              required: false,
              min: 0,
              max: 1,
              control: controls.startImage,
            },
          ]
        : [],
    promptComposition: existing.promptComposition || null,
    aspectRatios: existing.aspectRatios || existing.aspects || [],
    aspectPolicy: existing.aspectPolicy === "reference" ? "reference" : "manual",
    nodes: nodes.map((node) => ({
      id: node.id,
      classType: node.classType,
      title: node.title,
      inputs: Object.keys(node.inputs || {}),
      suggestedInputs: nodeInputsForClass(node.classType).filter((input) => input in node.inputs),
    })),
  };
}
