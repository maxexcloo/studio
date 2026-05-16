import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { dataDir } from './gallery-store.js';
import { root } from './comfy.js';

export const bundledWorkflowsDir = path.join(root, "workflows");
export const userWorkflowsDir = path.join(dataDir, "workflows");

function safeId(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || `workflow-${crypto.randomUUID()}`;
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function graphFromJson(raw) {
  if (raw?.graph && typeof raw.graph === "object") return raw.graph;
  const copy = { ...raw };
  delete copy.jAiStudio;
  delete copy.j_ai_studio;
  delete copy.metadata;
  return copy;
}

export function metadataFromJson(raw, file) {
  const meta = raw?.jAiStudio || raw?.j_ai_studio || {};
  const id = safeId(meta.id || path.basename(file || "", path.extname(file || "")));
  const graph = graphFromJson(raw);
  const controls = meta.controls || {};
  const graphDefault = (key) => {
    const mapping = controls[key];
    return mapping?.node && mapping?.input ? graph?.[mapping.node]?.inputs?.[mapping.input] : undefined;
  };
  const classes = [...new Set(Object.values(graph || {}).map((node) => node?.class_type).filter(Boolean))];
  return {
    id,
    profileId: `custom:${id}`,
    name: meta.name || id,
    description: meta.description || "Custom ComfyUI workflow",
    kind: meta.kind === "video" ? "video" : "image",
    family: meta.family || "custom",
    graph,
    controls,
    requiredNodes: Array.isArray(meta.requiredNodes) && meta.requiredNodes.length ? meta.requiredNodes : classes,
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
      ...(meta.defaults || {})
    },
    aspectRatios: meta.aspectRatios || meta.aspects || [],
    capabilities: {
      negativePrompt: Boolean(controls.negative),
      variations: Boolean(controls.count),
      frames: Boolean(controls.frames),
      fps: Boolean(controls.fps),
      startImage: Boolean(controls.startImage),
      denoise: Boolean(controls.denoise),
      textEncoder: Boolean(controls.textEncoder),
      vae: Boolean(controls.vae),
      clipType: Boolean(controls.clipType),
      weightDtype: Boolean(controls.weightDtype),
      ...(meta.capabilities || {})
    },
    path: file || ""
  };
}

export function validateGraph(graph) {
  if (!graph || typeof graph !== "object" || !Object.keys(graph).length) throw new Error("Workflow JSON does not contain a ComfyUI API graph.");
  for (const [id, node] of Object.entries(graph)) {
    if (!node?.class_type) throw new Error(`Workflow node ${id} is missing class_type.`);
    for (const value of Object.values(node.inputs || {})) {
      if (Array.isArray(value) && typeof value[0] === "string" && !graph[value[0]]) {
        throw new Error(`Workflow node ${id} references missing node ${value[0]}.`);
      }
    }
  }
}

export function allCustomWorkflowRecords() {
  const dirs = [
    { dir: bundledWorkflowsDir, source: "bundled" },
    { dir: userWorkflowsDir, source: "custom" }
  ];
  const items = [];
  for (const { dir, source } of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((name) => name.endsWith(".json"))) {
      const fullPath = path.join(dir, file);
      const raw = readJson(fullPath);
      if (!raw) {
        items.push({
          id: safeId(path.basename(file, ".json")),
          profileId: `custom:${safeId(path.basename(file, ".json"))}`,
          name: path.basename(file, ".json"),
          description: "Workflow JSON could not be parsed.",
          kind: "image",
          family: "custom",
          graph: {},
          controls: {},
          requiredNodes: [],
          defaults: {},
          capabilities: {},
          path: fullPath,
          source,
          parseError: "Invalid JSON"
        });
        continue;
      }
      try {
        items.push({ ...metadataFromJson(raw, fullPath), source, raw });
      } catch (error) {
        items.push({
          id: safeId(path.basename(file, ".json")),
          profileId: `custom:${safeId(path.basename(file, ".json"))}`,
          name: path.basename(file, ".json"),
          description: error.message || "Workflow could not be read.",
          kind: "image",
          family: "custom",
          graph: {},
          controls: {},
          requiredNodes: [],
          defaults: {},
          capabilities: {},
          path: fullPath,
          source,
          parseError: error.message
        });
      }
    }
  }
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

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

export function getCustomWorkflow(profileId) {
  return loadCustomWorkflows().find((workflow) => workflow.profileId === profileId || workflow.id === profileId || `custom:${workflow.id}` === profileId) || null;
}

export function saveCustomWorkflow(raw) {
  const workflow = metadataFromJson(raw);
  validateGraph(workflow.graph);
  fs.mkdirSync(userWorkflowsDir, { recursive: true });
  const file = path.join(userWorkflowsDir, `${workflow.id}.json`);
  fs.writeFileSync(file, JSON.stringify(raw, null, 2));
  return { ...workflow, path: file };
}

export function saveImportedWorkflow(raw, meta = {}) {
  const mergedMeta = {
    ...(raw?.jAiStudio || raw?.j_ai_studio || {}),
    ...meta
  };
  const workflow = metadataFromJson({ ...raw, jAiStudio: mergedMeta });
  fs.mkdirSync(userWorkflowsDir, { recursive: true });
  const file = path.join(userWorkflowsDir, `${workflow.id}.json`);
  fs.writeFileSync(file, JSON.stringify({ ...raw, jAiStudio: mergedMeta }, null, 2));
  return { ...workflow, path: file };
}

export function deleteImportedWorkflow(id) {
  const safe = safeId(id);
  const file = path.join(userWorkflowsDir, `${safe}.json`);
  const base = path.resolve(userWorkflowsDir);
  const resolved = path.resolve(file);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) throw new Error("Invalid workflow path.");
  if (!fs.existsSync(resolved)) throw new Error("Workflow file was not found.");
  fs.unlinkSync(resolved);
  return { ok: true, id: safe };
}

function nodeInputsForClass(classType = "") {
  if (/KSampler/i.test(classType)) return ["seed", "steps", "cfg", "sampler_name", "scheduler", "denoise"];
  if (/TextEncode/i.test(classType)) return ["text"];
  if (/Latent|Image/i.test(classType)) return ["width", "height", "batch_size"];
  if (/Video/i.test(classType)) return ["length", "fps", "width", "height"];
  return [];
}

export function detectWorkflowMetadata(raw, fallbackName = "") {
  const existing = raw?.jAiStudio || raw?.j_ai_studio || {};
  const graph = graphFromJson(raw);
  const nodes = Object.entries(graph || {}).map(([id, node]) => ({ id, classType: node?.class_type || "", inputs: node?.inputs || {} }));
  const textNodes = nodes.filter((node) => /TextEncode/i.test(node.classType) && "text" in node.inputs);
  const latentNode = nodes.find((node) => /Latent/i.test(node.classType) && ("width" in node.inputs || "height" in node.inputs));
  const samplerNode = nodes.find((node) => /Sampler/i.test(node.classType));
  const videoNode = nodes.find((node) => /Video/i.test(node.classType) && ("length" in node.inputs || "fps" in node.inputs));
  const controls = {
    ...(existing.controls || {})
  };
  const set = (key, node, input) => {
    if (!controls[key] && node && input && input in node.inputs) controls[key] = { node: node.id, input };
  };
  set("prompt", textNodes[0], "text");
  set("negative", textNodes[1], "text");
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
  const hasVideo = nodes.some((node) => /Video|VHS|Wan/i.test(node.classType));
  const id = safeId(existing.id || fallbackName || "imported-workflow");
  return {
    id,
    name: existing.name || fallbackName || id,
    description: existing.description || "Imported ComfyUI workflow",
    kind: existing.kind === "video" || hasVideo ? "video" : "image",
    family: existing.family || "custom",
    controls,
    defaults: existing.defaults || {},
    capabilities: existing.capabilities || {},
    aspectRatios: existing.aspectRatios || existing.aspects || [],
    nodes: nodes.map((node) => ({
      id: node.id,
      classType: node.classType,
      inputs: Object.keys(node.inputs || {}),
      suggestedInputs: nodeInputsForClass(node.classType).filter((input) => input in node.inputs)
    }))
  };
}
