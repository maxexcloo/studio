import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { comfy } from "./comfy.js";
import { isInside, pathKey, samePath } from "./paths.js";

/**
 * Model folders ComfyUI is not reading, and the one-line fix for each.
 *
 * People keep models in a shared folder, in another ComfyUI install, in
 * Stability Matrix or A1111, or on an external drive, and then ComfyUI (so
 * Studio) simply never lists them. This finds such folders on the machine
 * ComfyUI runs on, says what is in them, and adds them to ComfyUI's
 * extra_model_paths.yaml as a marked section Studio can take out again.
 *
 * Only folder and file names are read, never file contents.
 */

const modelFile = /\.(safetensors|ckpt|pt|pth|gguf|sft|bin)$/i;
// Kinds that are not models, or not ones a person drops in by hand.
const skipKinds = new Set(["custom_nodes", "configs", "input", "output", "temp"]);
const legacy = { unet: "diffusion_models", clip: "text_encoders", ...derivedKinds() };

/**
 * Kinds a custom node builds from a core kind at load time. ComfyUI-GGUF sets
 * unet_gguf to diffusion_models' folders (and clip_gguf to text_encoders'),
 * replacing whatever extra_model_paths.yaml gave unet_gguf, so a folder added
 * under the derived name is never read. Such folders are added under the core
 * kind instead, which the derived one then inherits.
 */
function derivedKinds() {
  return { unet_gguf: "diffusion_models", clip_gguf: "text_encoders" };
}

/** Rewrites derived kinds in Studio's own sections to their core kind; other text is left alone. */
export function migrateDerivedKinds(text = "") {
  let changed = [];
  const next = text.replace(
    /# >>> Added by Studio: ([^\r\n]*)([\s\S]*?)# <<< Studio/g,
    (block, dir, body) => {
      const fixed = body.replace(
        /^(    )(unet_gguf|clip_gguf):/gm,
        (_m, indent, kind) => `${indent}${derivedKinds()[kind]}:`,
      );
      if (fixed !== body) changed.push(dir.trim());
      return `# >>> Added by Studio: ${dir}${fixed}# <<< Studio`;
    },
  );
  return { text: next, changed };
}

// Other apps' model folders, by their own names, mapped to ComfyUI's kinds.
const layouts = {
  stability: {
    label: "Stability Matrix",
    folders: {
      StableDiffusion: "checkpoints",
      DiffusionModels: "diffusion_models",
      Unet: "diffusion_models",
      Lora: "loras",
      LyCORIS: "loras",
      VAE: "vae",
      TextEncoders: "text_encoders",
      CLIP: "text_encoders",
      ClipVision: "clip_vision",
      ControlNet: "controlnet",
      ESRGAN: "upscale_models",
      RealESRGAN: "upscale_models",
      SwinIR: "upscale_models",
      TextualInversion: "embeddings",
      Embeddings: "embeddings",
      Hypernetwork: "hypernetworks",
      GLIGEN: "gligen",
      ApproxVAE: "vae_approx",
    },
  },
  a1111: {
    label: "Stable Diffusion WebUI",
    folders: {
      "Stable-diffusion": "checkpoints",
      Lora: "loras",
      LyCORIS: "loras",
      VAE: "vae",
      ESRGAN: "upscale_models",
      RealESRGAN: "upscale_models",
      ControlNet: "controlnet",
      hypernetworks: "hypernetworks",
      "VAE-approx": "vae_approx",
    },
  },
};

/* ------------------------------------------------------------ helpers */

function realpath(dir) {
  try {
    return fs.realpathSync(dir);
  } catch {
    return path.resolve(dir);
  }
}

function isDir(dir) {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function subdirs(dir) {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter(
        (entry) => (entry.isDirectory() || entry.isSymbolicLink()) && !entry.name.startsWith("."),
      )
      .map((entry) => entry.name)
      .filter((name) => isDir(path.join(dir, name)));
  } catch {
    return [];
  }
}

/** The same as subdirs, without blocking the event loop; a folder that does not answer in time counts as empty. */
async function subdirsAsync(dir, timeout = 1500) {
  const list = async () => {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    const names = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (entry.isDirectory()) names.push(entry.name);
      else if (entry.isSymbolicLink()) {
        try {
          if ((await fs.promises.stat(path.join(dir, entry.name))).isDirectory())
            names.push(entry.name);
        } catch {
          /* dangling */
        }
      }
    }
    return names;
  };
  return withTimeout(
    list().catch(() => []),
    timeout,
    [],
  );
}

function withTimeout(promise, ms, fallback) {
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}

/** Model files in a folder and three levels below it (people sort into subfolders). */
function modelFiles(dir, limit = 400) {
  const found = [];
  let bytes = 0;
  const visit = (folder, depth) => {
    let entries = [];
    try {
      entries = fs.readdirSync(folder, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= limit || entry.name.startsWith(".")) continue;
      const full = path.join(folder, entry.name);
      if (entry.isFile() && modelFile.test(entry.name) && !entry.name.endsWith(".part")) {
        found.push(path.relative(dir, full));
        try {
          bytes += fs.statSync(full).size;
        } catch {
          /* gone meanwhile */
        }
      } else if (entry.isDirectory() && depth < 3) {
        visit(full, depth + 1);
      }
    }
  };
  visit(dir, 0);
  return { files: found, bytes };
}

/** A native path shortened with ~ for home. */
export function tildePath(dir, home = os.homedir()) {
  return dir === home || dir.startsWith(`${home}/`) ? `~${dir.slice(home.length)}` : dir;
}

/* ------------------------------------------------------------ ComfyUI */

function flatten(value) {
  // Older ComfyUI answers [paths, extensions] per kind; newer ones just the paths.
  const list = Array.isArray(value?.[0]) ? value[0] : value;
  return Array.isArray(list) ? list.filter((item) => typeof item === "string") : [];
}

function argValues(argv, flag) {
  const values = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = String(argv[index] || "");
    if (arg === flag && argv[index + 1]) values.push(String(argv[index + 1]));
    else if (arg.startsWith(`${flag}=`)) values.push(arg.slice(flag.length + 1));
  }
  return values;
}

/**
 * Where ComfyUI reads models from and which config file it would read a new
 * folder from: a file it was started with, else
 * extra_model_paths.yaml in its own folder, which ComfyUI always loads.
 */
async function comfyModelSetup() {
  const [folders, stats] = await Promise.all([
    comfy("/internal/folder_paths").catch(() => null),
    comfy("/system_stats").catch(() => null),
  ]);
  if (!folders) return null;
  const kinds = {};
  for (const [kind, value] of Object.entries(folders)) {
    if (!skipKinds.has(kind)) kinds[kind] = flatten(value).map(realpath);
  }
  const nodesDirs = flatten(folders.custom_nodes);
  const argv = Array.isArray(stats?.system?.argv) ? stats.system.argv : [];
  // ComfyUI's own folder: the one whose custom_nodes it loads and that holds main.py.
  const root =
    nodesDirs
      .map((dir) => path.dirname(dir))
      .find((dir) => fs.existsSync(path.join(dir, "main.py"))) || "";
  const baseDir = argValues(argv, "--base-directory")[0] || "";
  const workingDir = root || baseDir || ".";
  const configs = argValues(argv, "--extra-model-paths-config").map((file) =>
    path.resolve(workingDir, file),
  );
  const rootConfig = root ? path.join(root, "extra_model_paths.yaml") : "";
  // Prefer the configured file, then ComfyUI's own file, where writable.
  const configPath =
    [...configs, rootConfig].find((file) => file && canWrite(file)) || configs[0] || rootConfig;
  return { kinds, root, configPath, reachable: Boolean(root || configs.length) };
}

/** Whether the native filesystem permits writing the config and a backup beside it. */
function canWrite(file) {
  try {
    if (fs.existsSync(file)) fs.accessSync(file, fs.constants.W_OK);
    fs.accessSync(path.dirname(file), fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------ finding folders */

/**
 * How a folder maps onto ComfyUI's kinds, or null when it is not a models
 * folder: ComfyUI's own names (models/checkpoints, models/loras, ...), or
 * Stability Matrix's or A1111's.
 */
export function readLayout(dir, knownKinds) {
  return layoutFromNames(subdirs(dir), knownKinds);
}

function layoutFromNames(names, knownKinds) {
  if (!names.length) return null;
  const valid = new Set(knownKinds);
  const comfyKinds = names
    .map((name) => ({ name, kind: legacy[name] || name }))
    .filter(({ kind }) => valid.has(kind));
  // Two of ComfyUI's model folder names, one of them a core one, is a models folder.
  const core = comfyKinds.some(({ kind }) =>
    ["checkpoints", "diffusion_models", "loras", "vae", "text_encoders"].includes(kind),
  );
  if (comfyKinds.length >= 2 && core)
    return {
      layout: "comfy",
      label: "",
      map: comfyKinds.map(({ name, kind }) => ({ name, kind })),
    };
  for (const [id, spec] of Object.entries(layouts)) {
    const map = names
      .filter((name) => spec.folders[name] && valid.has(spec.folders[name]))
      .map((name) => ({ name, kind: spec.folders[name] }));
    if (map.length >= 2) return { layout: id, label: spec.label, map };
  }
  return null;
}

const skipNames =
  /^(Library|Applications|System|node_modules|Pictures|Music|Movies|Photos Library\.photoslibrary|proc|sys|dev|snap|venv|\.venv|site-packages|__pycache__)$/i;

/** Folders worth a look: shared spots other apps use, then a shallow walk of home and the other drives. */
async function candidateRoots(home, drivesToo = true) {
  const explicit = [];
  const add = (dir, source) => {
    if (dir) explicit.push({ dir, source });
  };
  if (process.platform === "darwin") {
    const support = path.join(home, "Library", "Application Support");
    add(path.join(support, "StabilityMatrix", "Models"), "stability");
    add(path.join(support, "StabilityMatrix", "Data", "Models"), "stability");
  } else {
    add(path.join(home, ".config", "StabilityMatrix", "Models"), "stability");
  }
  const walkRoots = [{ dir: home, depth: 4, source: "home" }];
  const drives = !drivesToo
    ? ""
    : process.platform === "darwin"
      ? "/Volumes"
      : process.platform === "linux"
        ? path.join("/media", os.userInfo().username)
        : "";
  if (drives) {
    for (const name of await subdirsAsync(drives)) {
      const dir = path.join(drives, name);
      if (realpath(dir) !== "/") walkRoots.push({ dir, depth: 3, source: "drive" });
    }
  }
  return { explicit, walkRoots };
}

/**
 * Every models folder on this machine, found by shape: ComfyUI installs,
 * shared folders, other apps. Bounded so a huge disk cannot stall setup, and
 * asynchronous with a time limit per folder, so a slow drive never blocks the
 * server while it looks.
 */
async function findModelFolders(
  knownKinds,
  { home = os.homedir(), drives = true, budget = 6000, deadline } = {},
) {
  const { explicit, walkRoots } = await candidateRoots(home, drives);
  const until = deadline ?? Date.now() + 4000;
  const found = new Map();
  // Returns the folder's subfolder names when it is not a models folder, for the walk to go on.
  const consider = async (dir, source) => {
    const names = await subdirsAsync(dir);
    const real = realpath(dir);
    if (found.has(pathKey(real))) return null;
    const layout = layoutFromNames(names, knownKinds);
    if (!layout) return names;
    found.set(pathKey(real), { dir: real, source, ...layout });
    return null;
  };
  for (const { dir, source } of explicit) await consider(dir, source);
  let visited = 0;
  for (const { dir: start, depth: maxDepth, source } of walkRoots) {
    const queue = [{ dir: start, depth: 0 }];
    while (queue.length && visited < budget && Date.now() < until) {
      const { dir, depth } = queue.shift();
      visited += 1;
      // A models folder is a leaf here: its own subfolders are its kinds.
      const names = depth > 0 ? await consider(dir, source) : await subdirsAsync(dir);
      if (!names || depth >= maxDepth) continue;
      for (const name of names) {
        if (skipNames.test(name)) continue;
        queue.push({ dir: path.join(dir, name), depth: depth + 1 });
      }
    }
  }
  return [...found.values()];
}

/* ------------------------------------------------------------ the config file */

const startMark = "# >>> Added by Studio:";
const endMark = "# <<< Studio";

/** Sections Studio added before, by the folder they point at. */
export function studioModelSections(text = "") {
  const sections = [];
  // Imported configuration may use CRLF line endings.
  const pattern = /^# >>> Added by Studio: (.+?)\r?\n([\s\S]*?)^# <<< Studio\s*$/gm;
  for (const match of text.matchAll(pattern))
    sections.push({ path: match[1].trim(), block: match[0] });
  return sections;
}

/** The folders a Studio section adds (base_path joined with each kind's names), as written by sectionFor. */
export function sectionDirs(section) {
  const dirs = [];
  let multi = false;
  for (const raw of section.block.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    const entry = line.match(/^    ([A-Za-z0-9_]+): (.+)$/);
    if (entry) {
      multi = entry[2] === "|";
      if (entry[1] !== "base_path" && !multi) dirs.push(unquote(entry[2]));
    } else if (multi && /^        \S/.test(line)) {
      dirs.push(line.trim());
    } else {
      multi = false;
    }
  }
  return dirs.map((name) => path.resolve(section.path, name));
}

function unquote(value) {
  return value.startsWith("'") && value.endsWith("'")
    ? value.slice(1, -1).replace(/''/g, "'")
    : value;
}

function yamlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** The extra_model_paths.yaml section for one folder: its kinds, several folders per kind on their own lines. */
export function sectionFor(dir, kinds, existingText = "") {
  const byKind = new Map();
  for (const { kind, name } of kinds) byKind.set(kind, [...(byKind.get(kind) || []), name]);
  const slug = path.basename(path.dirname(dir)) + "_" + path.basename(dir);
  let key = `heiss_${
    slug
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "") || "models"
  }`;
  for (let n = 2; new RegExp(`^${key}:`, "m").test(existingText); n += 1)
    key = `${key.replace(/_\d+$/, "")}_${n}`;
  const lines = [`${startMark} ${dir}`, `${key}:`, `    base_path: ${yamlString(dir)}`];
  for (const [kind, names] of byKind) {
    if (names.length === 1) lines.push(`    ${kind}: ${yamlString(names[0])}`);
    else lines.push(`    ${kind}: |`, ...names.map((name) => `        ${name}`));
  }
  lines.push(endMark);
  return lines.join("\n") + "\n";
}

/* ------------------------------------------------------------ report */

let lastReport = null;

/**
 * What a setup panel needs: every models folder with files ComfyUI is not
 * reading, what they hold, and the folders Studio already added.
 */
export async function modelFolderReport({ local = true, scan = {} } = {}) {
  const setup = await comfyModelSetup();
  if (!setup) return { ok: false, offline: true, folders: [], linked: [] };
  if (!local || !setup.reachable) {
    return { ok: true, local: false, folders: [], linked: [], configPath: setup.configPath };
  }
  const knownKinds = Object.keys(setup.kinds);
  const read = new Set(
    Object.values(setup.kinds)
      .flat()
      .map((dir) => pathKey(dir)),
  );
  let configText = "";
  try {
    configText = fs.readFileSync(setup.configPath, "utf8");
  } catch {
    /* not made yet */
  }
  // `read`: ComfyUI has picked the folder up, which only happens once it restarted after Studio added it.
  const readDirs = Object.values(setup.kinds).flat();
  // Read only when ComfyUI reads every folder the section adds, not just any folder
  // inside it: a ComfyUI's own models folder has read subfolders from the start.
  const linked = studioModelSections(configText).map((section) => {
    const dirs = sectionDirs(section).map(realpath);
    const allRead = dirs.length
      ? dirs.every((dir) => read.has(pathKey(dir)))
      : readDirs.some((dir) => isInside(realpath(section.path), dir, { orSame: true }));
    return { path: section.path, label: tildePath(section.path), read: allRead };
  });
  const folders = [];
  for (const folder of await findModelFolders(knownKinds, scan)) {
    const kinds = [];
    for (const { name, kind } of folder.map) {
      const dir = realpath(path.join(folder.dir, name));
      if (read.has(pathKey(dir))) continue;
      const { files, bytes } = modelFiles(dir);
      if (!files.length) continue;
      kinds.push({
        kind,
        name,
        dir,
        count: files.length,
        bytes,
        examples: files.slice(0, 3).map((file) => path.basename(file)),
      });
    }
    if (!kinds.length) continue;
    const parent = path.basename(path.dirname(folder.dir));
    folders.push({
      path: folder.dir,
      label: tildePath(folder.dir),
      // "ComfyUI-Shared", or the app it belongs to.
      name:
        folder.label ||
        (path.basename(folder.dir).toLowerCase() === "models" ? parent : path.basename(folder.dir)),
      layout: folder.layout,
      app: folder.label,
      // ComfyUI already reads some of this folder (its own models folder, say):
      // only the listed subfolders are new to it.
      partlyRead: readDirs.some((dir) => isInside(folder.dir, dir)),
      source: folder.source,
      kinds,
      count: kinds.reduce((sum, item) => sum + item.count, 0),
      bytes: kinds.reduce((sum, item) => sum + item.bytes, 0),
    });
  }
  folders.sort((a, b) => b.count - a.count);
  lastReport = {
    ok: true,
    local: true,
    root: setup.root,
    configPath: setup.configPath,
    configLabel: tildePath(setup.configPath),
    writable: canWrite(setup.configPath),
    folders,
    linked,
    scannedAt: Date.now(),
  };
  return lastReport;
}

/**
 * Adds folders to ComfyUI's model paths. Only folders the last scan found (or
 * one the person picked and that reads as a models folder) are accepted, and
 * only the kinds ComfyUI does not read yet. The file is backed up first.
 */
export async function linkModelFolders(paths = [], { picked = "", scan = {} } = {}) {
  const report = lastReport?.ok ? lastReport : await modelFolderReport({ scan });
  if (!report.local)
    throw new Error(
      "ComfyUI runs on another computer, so its settings can’t be changed from here.",
    );
  const chosen = [];
  for (const wanted of paths.map(String)) {
    const folder = report.folders.find(
      (item) => item.path === wanted || samePath(item.path, realpath(wanted)),
    );
    if (folder) chosen.push(folder);
  }
  if (picked) {
    const setup = await comfyModelSetup();
    const dir = realpath(picked);
    const layout = readLayout(dir, Object.keys(setup?.kinds || {}));
    if (!layout)
      throw new Error(
        "That doesn’t look like a models folder. Choose the one with checkpoints, loras or diffusion_models in it.",
      );
    chosen.push({ path: dir, kinds: layout.map.map(({ name, kind }) => ({ name, kind })) });
  }
  if (!chosen.length) throw new Error("Nothing to add. Scan again and pick a folder.");
  // An added folder is written under its real path, which is also how it is reported back.
  const file = report.configPath;
  if (!file) throw new Error("Couldn’t find where ComfyUI keeps its settings.");
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    /* a new file */
  }
  // Preserve the imported file's line endings.
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const already = new Set(studioModelSections(text).map((section) => pathKey(section.path)));
  const backup = text ? `${file}.heiss-backup` : "";
  // Sections an older HEISS wrote under a derived kind never took; fix them in place.
  const migrated = migrateDerivedKinds(text);
  let next =
    migrated.text && !migrated.text.endsWith("\n") ? `${migrated.text}${eol}` : migrated.text;
  const added = [...migrated.changed];
  for (const folder of chosen) {
    if (already.has(pathKey(folder.path))) continue;
    already.add(pathKey(folder.path));
    next += `${next ? eol : ""}${sectionFor(folder.path, folder.kinds, next).replace(/\n/g, eol)}`;
    added.push(folder.path);
  }
  if (!added.length) return { ok: true, added, configPath: file, backup: "" };
  try {
    if (backup) fs.copyFileSync(file, backup);
    fs.writeFileSync(file, next);
  } catch (error) {
    throw new Error(`Couldn’t write ${tildePath(file)} (${error.code || error.message}).`);
  }
  lastReport = null;
  return { ok: true, added, configPath: file, backup };
}

/** Takes a folder Studio added back out of ComfyUI's model paths. */
export async function unlinkModelFolder(dir) {
  const setup = await comfyModelSetup();
  if (!setup?.configPath) throw new Error("Can’t reach ComfyUI.");
  const text = fs.readFileSync(setup.configPath, "utf8");
  const section =
    studioModelSections(text).find((item) => item.path === String(dir)) ||
    studioModelSections(text).find(
      (item) => samePath(item.path, String(dir)) || samePath(item.path, realpath(String(dir))),
    );
  if (!section) throw new Error("Only folders added here can be removed here.");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  // The blank line that went in before the section goes out with it.
  let next = text
    .replace(section.block, "")
    .replace(/(\r?\n){3,}/g, eol + eol)
    .replace(/(\r?\n)+$/, eol);
  // ComfyUI's loader walks the file as a mapping and fails on one that is only
  // comments, so a file with nothing left in it goes, and a comments-only one gets `{}`.
  if (!next.trim()) fs.rmSync(setup.configPath);
  else
    fs.writeFileSync(
      setup.configPath,
      /^[^#\s]/m.test(next) ? next : `${next.trimEnd()}${eol}{}${eol}`,
    );
  lastReport = null;
  return { ok: true, removed: section.path };
}
