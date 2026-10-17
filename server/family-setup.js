import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { hasNode, optionsFor } from "./comfy.js";
import { families } from "./family-catalog.js";
import { catalogDownload, preferredDownload } from "./family-profiles.js";
import { diffusersFolderComplete, diffusersFolders, diffusersTarget } from "./diffusers-folders.js";
import { hfEndpoint, hfToken } from "./hf-access.js";
import { classifyEncoder, classifyVae, rankEncoders, rankVaes } from "./model-components.js";
import { existingCopy } from "./model-downloads.js";
import { comfyPython, comfyRootDir, pythonEnv } from "./node-install.js";
import { missingPackPart } from "./node-install.js";
import { nodePack } from "./node-packs.js";

/**
 * Guided setup for model families people go and get on purpose, rather than
 * drop into ComfyUI: a version to pick, the way ComfyUI will run it, and every
 * file it needs, in one dialog that watches ComfyUI until the model is ready.
 *
 * A family can run two ways (its `runners` in the catalog): on ComfyUI's own
 * nodes with single files (one-click catalog downloads), or on a custom node
 * pack that loads a whole Hugging Face Diffusers folder. Such a folder is
 * fetched by ComfyUI's own Python with huggingface_hub (which ComfyUI already
 * has through transformers), so nothing new is installed for it.
 *
 * setup: { title, maker, tag (a word for the offer, "New"), blurb, license, page, packSource (the catalog source
 *   that runs on the pack), versions: [{ id, label, detail, repo, folder,
 *   folderBytes, builds: { <build id>: catalog model download id } }],
 *   builds: [{ id, label, detail }] }
 */
export const guidedSetups = {
  moss_image: {
    title: "MOSS-Image",
    maker: "OpenMOSS",
    tag: "New",
    blurb: "A 5B model with clean text in pictures, layouts that hold, and room to fine-tune.",
    license: "Apache 2.0",
    page: "https://github.com/OpenMOSS/MOSS-Image",
    packSource: "moss_diffusers",
    versions: [
      {
        id: "sft", label: "SFT", detail: "Tuned on curated pictures. The one to draw with.",
        repo: "OpenMOSS-Team/MOSS-Image-SFT", folder: "MOSS-Image-SFT", folderBytes: 27_219_859_058,
        builds: { int8: "model:moss_image_sft_int8:0", bf16: "model:moss_image_sft_bf16:0" }
      },
      {
        id: "base", label: "Base", detail: "The pre-trained model, for training LoRAs.",
        repo: "OpenMOSS-Team/MOSS-Image-Base", folder: "MOSS-Image-Base", folderBytes: 27_219_859_058,
        builds: { int8: "model:moss_image_base_int8:0", bf16: "model:moss_image_base_bf16:0" }
      }
    ],
    builds: [
      { id: "int8", label: "Compact", detail: "int8, half the size, close to full quality" },
      { id: "bf16", label: "Full precision", detail: "bf16, as trained" }
    ]
  }
};

/** The files the folder download leaves out: the model card's pictures. */
const folderIgnore = ["assets/*", "*.md", ".gitattributes", ".gitignore"];

/* ------------------------------------------------------------ Plan */

/**
 * Everything the setup dialog shows for one family, from ComfyUI's current
 * node list and the files on disk.
 *
 * profiles: inferModels' profiles (which ones are ready, and what they lack).
 * device: { apple } puts Mac-loadable builds first, as the setup panel does.
 */
export function familySetupPlan(familyId, { info = null, profiles = [], local = false, device = {}, onDisk = existingCopy, comfyVersion = "" } = {}) {
  const setup = guidedSetups[familyId];
  const family = families[familyId];
  if (!setup || !family) return null;
  const online = Boolean(info && Object.keys(info).length);
  const packRunner = family.runners?.[setup.packSource];
  const pack = packRunner ? nodePack(packRunner.pack) : null;
  const loader = family.slots.length === 2 ? "DualCLIPLoader" : "CLIPLoader";
  const native = online && (!family.clipType || optionsFor(info, loader, "type").includes(family.clipType))
    && (family.requiredNodes || []).every((node) => hasNode(info, node));
  const packPart = online && pack ? missingPackPart(info, packRunner.pack, { detail: packRunner.note }) : null;
  const packLoaded = Boolean(online && pack && !packPart);
  const packReady = packLoaded && (packRunner.requiredNodes || []).every((node) => hasNode(info, node));

  const encoders = online ? optionsFor(info, "CLIPLoader", "clip_name").map(classifyEncoder) : [];
  const vaes = online ? optionsFor(info, "VAELoader", "vae_name").map(classifyVae) : [];
  const unets = new Set(online ? optionsFor(info, "UNETLoader", "unet_name") : []);
  const familyProfiles = profiles.filter((profile) => profile.family === familyId);
  const withDisk = (spec, part) => spec && ({
    id: spec.id, file: spec.file, folder: spec.folder, label: spec.label, bytes: spec.bytes || 0, url: spec.url,
    fp8: Boolean(spec.fp8), part, onDisk: Boolean(onDisk(spec)), listed: part === "model" ? unets.has(spec.file) : false
  });

  // The text encoder and VAE are shared by every version and build.
  const shared = [];
  for (const slot of family.slots) {
    const have = rankEncoders(encoders, slot);
    const spec = preferredDownload("encoder", slot.download || slot.kinds[0], device);
    shared.push({ part: "encoder", label: `${slot.label} text encoder`, have: have[0] || "", download: have.length ? null : withDisk(spec, "encoder") });
  }
  const haveVae = rankVaes(vaes, family.vae);
  shared.push({ part: "vae", label: "Flux.2 VAE", have: haveVae[0] || "", download: haveVae.length ? null : withDisk(preferredDownload("vae", family.vae[0], device), "vae") });

  const folders = local && packRunner?.folders ? diffusersFolders(packRunner.folders.classNames) : [];
  const versions = setup.versions.map((version) => {
    const builds = Object.fromEntries(Object.entries(version.builds).map(([build, id]) => {
      const model = withDisk(catalogDownload(id), "model");
      const ready = familyProfiles.find((profile) => profile.source === "unet" && profile.model === model.file && profile.ready);
      return [build, { model, ready: ready ? ready.id : "" }];
    }));
    const folderReady = familyProfiles.find((profile) => profile.source === setup.packSource && profile.model === version.folder && profile.ready);
    return {
      id: version.id, label: version.label, detail: version.detail, repo: version.repo,
      builds,
      folder: {
        name: version.folder,
        present: folders.includes(version.folder),
        bytes: version.folderBytes,
        ready: folderReady ? folderReady.id : ""
      }
    };
  });

  // ComfyUI's own nodes when this ComfyUI has them; the makers' pack when it is in
  // (or when ComfyUI is too old for the first), since it runs on releases from 0.38 on.
  const recommended = native && !packLoaded ? "native" : packLoaded ? "pack" : native ? "native" : "pack";
  const job = folderJobs.get(familyId);
  return {
    family: familyId,
    title: setup.title, maker: setup.maker, blurb: setup.blurb, license: setup.license, page: setup.page,
    builds: setup.builds,
    versions,
    shared,
    comfy: {
      online, local, version: comfyVersion,
      native,
      // A ComfyUI on this computer can fetch a model folder itself.
      folderDownload: local && Boolean(comfyPython(comfyRootDir())),
      folderTarget: local ? diffusersTarget() : "",
      pack: pack ? { id: pack.id, name: pack.name, loaded: packLoaded, ready: packReady, part: packPart } : null
    },
    recommended,
    folderJob: job ? jobSnapshot(job) : null
  };
}

/* ------------------------------------------------------------ Folder downloads */

/**
 * One Hugging Face Diffusers folder at a time per family, fetched by
 * huggingface_hub's snapshot_download in ComfyUI's Python straight into
 * models/diffusers/<folder>. It resumes by itself, keeps its partial files in
 * the folder's .cache, and checks every file against the Hub's hashes.
 * Progress is the folder's size on disk against the repository's.
 */
const folderJobs = new Map();

function folderSize(dir) {
  let total = 0;
  const walk = (current) => {
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const file = path.join(current, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (entry.isFile()) {
        try { total += fs.statSync(file).size; } catch { /* gone mid-walk */ }
      }
    }
  };
  walk(dir);
  return total;
}

function jobSnapshot(job) {
  const now = Date.now();
  if (job.status === "running" && now - job.sampledAt > 900) {
    const bytes = folderSize(job.target);
    const seconds = (now - job.sampledAt) / 1000;
    // A smoothed rate, so the time left doesn't jump about between polls.
    const rate = Math.max(0, (bytes - job.receivedBytes) / seconds);
    job.bytesPerSecond = job.bytesPerSecond ? job.bytesPerSecond * 0.7 + rate * 0.3 : rate;
    job.receivedBytes = bytes;
    job.sampledAt = now;
  }
  const { child, ...rest } = job;
  return { ...rest, receivedBytes: Math.min(job.receivedBytes, job.totalBytes) };
}

export function folderDownloadState(familyId) {
  const job = folderJobs.get(familyId);
  return job ? jobSnapshot(job) : null;
}

/** The script ComfyUI's Python runs; every value in it comes from the catalog, never a request. */
function snapshotScript({ repo, target, ignore }) {
  return [
    "import sys",
    "from huggingface_hub import snapshot_download",
    `snapshot_download(${JSON.stringify(repo)}, local_dir=${JSON.stringify(target)}, ignore_patterns=${JSON.stringify(ignore)})`,
    "print('done')"
  ].join("\n");
}

/**
 * Starts (or resumes) fetching one version's folder. Only versions in
 * guidedSetups, only into ComfyUI's models/diffusers, only with ComfyUI's Python.
 * onDone runs after it lands (to rescan ComfyUI).
 */
export function startFolderDownload(familyId, versionId, { onDone = () => {}, spawnProcess = spawn } = {}) {
  const setup = guidedSetups[familyId];
  const version = setup?.versions.find((item) => item.id === versionId);
  if (!version) throw new Error("Unknown model version.");
  const current = folderJobs.get(familyId);
  if (current?.status === "running") return jobSnapshot(current);
  const python = comfyPython(comfyRootDir());
  const target = diffusersTarget(version.folder);
  if (!python || !target) throw new Error("ComfyUI isn’t on this computer. Use the command on the computer running it.");
  fs.mkdirSync(target, { recursive: true });
  const env = { ...pythonEnv(python), HF_HUB_DISABLE_TELEMETRY: "1", HF_HUB_DISABLE_PROGRESS_BARS: "1" };
  const mirror = hfEndpoint();
  if (mirror) env.HF_ENDPOINT = mirror.origin;
  const token = hfToken();
  if (token) env.HF_TOKEN = token;
  const job = {
    family: familyId, version: versionId, folder: version.folder, target, repo: version.repo,
    status: "running", error: "", log: "",
    totalBytes: version.folderBytes, receivedBytes: folderSize(target), bytesPerSecond: 0,
    startedAt: Date.now(), sampledAt: Date.now(), finishedAt: 0
  };
  const child = spawnProcess(python, ["-c", snapshotScript({ repo: version.repo, target, ignore: folderIgnore })], { cwd: path.dirname(target), env, windowsHide: true });
  job.child = child;
  const keep = (chunk) => { job.log = `${job.log}${chunk}`.slice(-4000); };
  child.stdout?.on("data", keep);
  child.stderr?.on("data", keep);
  child.on("error", (error) => {
    job.status = "error";
    job.error = `Couldn’t start ComfyUI’s Python: ${error.message}`;
    job.finishedAt = Date.now();
  });
  child.on("close", (code) => {
    if (job.status === "cancelled") return;
    job.receivedBytes = folderSize(target);
    job.finishedAt = Date.now();
    if (code === 0 && diffusersFolderComplete(target)) {
      job.status = "done";
      job.receivedBytes = job.totalBytes;
      onDone(job);
      return;
    }
    job.status = "error";
    job.error = /No module named ['"]?huggingface_hub/.test(job.log)
      ? "ComfyUI’s Python has no huggingface_hub. Use the command instead."
      : /\b(401|403)\b|gated|Unauthorized/i.test(job.log) ? "Hugging Face refused the download. Add a token in Settings › Models and try again."
      : /No space left|Errno 28/i.test(job.log) ? "The disk is full. Free up space and try again; it resumes where it stopped."
      : /ConnectionError|Timeout|Temporary failure|Max retries/i.test(job.log) ? "The connection dropped. Try again; it resumes where it stopped."
      : "The download stopped. Try again; it resumes where it stopped.";
  });
  folderJobs.set(familyId, job);
  return jobSnapshot(job);
}

export function cancelFolderDownload(familyId) {
  const job = folderJobs.get(familyId);
  if (!job || job.status !== "running") return job ? jobSnapshot(job) : null;
  job.status = "cancelled";
  job.finishedAt = Date.now();
  try { job.child?.kill(); } catch { /* already gone */ }
  return jobSnapshot(job);
}

/**
 * The same download as one command, for a ComfyUI HEISS can't run itself:
 * per shell, with ComfyUI's Python where it is known.
 */
export function folderDownloadCommand(familyId, versionId, platform = process.platform) {
  const setup = guidedSetups[familyId];
  const version = setup?.versions.find((item) => item.id === versionId);
  if (!version) return null;
  const win = platform === "win32";
  const python = comfyPython(comfyRootDir(), platform);
  const target = diffusersTarget(version.folder) || (win ? `ComfyUI\\models\\diffusers\\${version.folder}` : `ComfyUI/models/diffusers/${version.folder}`);
  const ignore = `[${folderIgnore.map((item) => `'${item}'`).join(", ")}]`;
  const code = `from huggingface_hub import snapshot_download; snapshot_download('${version.repo}', local_dir=r'${target}', ignore_patterns=${ignore})`;
  const exe = python ? `"${python}"` : win ? "python" : "python3";
  const commands = win
    ? [
      { shell: "powershell", label: "PowerShell", command: `${python ? "& " : ""}${exe} -c "${code}"` },
      { shell: "cmd", label: "Command Prompt", command: `${exe} -c "${code}"` }
    ]
    : [{ shell: "sh", label: "Terminal", command: `${exe} -c "${code}"` }];
  return { commands, target };
}
