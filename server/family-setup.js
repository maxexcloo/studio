import { hasNode, optionsFor } from "./comfy.js";
import { families } from "./family-catalog.js";
import { preferredDownload } from "./family-profiles.js";
import { classifyEncoder, classifyVae, rankEncoders, rankVaes, vaeKinds } from "./model-components.js";
import { existingCopy } from "./model-downloads.js";
import { missingPackPart } from "./node-install.js";
import { nodePack } from "./node-packs.js";

/**
 * Guided setup for a model you already put in ComfyUI, for families that can
 * run more than one way (their `runners` in the catalog). HEISS never fetches
 * the model itself: it recognises the file, works out how ComfyUI has to run
 * it, and walks through what that needs (an update, a node pack, the text
 * encoder and VAE), watching ComfyUI until the model is ready.
 *
 * setup: { title, maker, blurb, license, page, packSource (the catalog source
 *   that runs on the makers' pack), filesPage (where its single files are) }
 */
export const guidedSetups = {
  moss_image: {
    title: "MOSS-Image",
    maker: "OpenMOSS",
    blurb: "A 5B model with clean text in pictures, layouts that hold, and room to fine-tune.",
    license: "Apache 2.0",
    page: "https://github.com/OpenMOSS/MOSS-Image",
    filesPage: "https://huggingface.co/Comfy-Org/MOSS-Image",
    packSource: "moss_diffusers"
  }
};

/**
 * Everything the setup dialog shows for one model profile: which way it runs
 * (from what the file is), whether ComfyUI can run it that way yet, and the
 * parts it still lacks.
 *
 * profiles: inferModels' profiles. device: { apple } orders the encoder builds.
 */
export function familySetupPlan(familyId, { info = null, profiles = [], profileId = "", device = {}, onDisk = existingCopy, comfyVersion = "" } = {}) {
  const setup = guidedSetups[familyId];
  const family = families[familyId];
  if (!setup || !family) return null;
  const online = Boolean(info && Object.keys(info).length);
  const familyProfiles = profiles.filter((profile) => profile.family === familyId);
  const profile = familyProfiles.find((item) => item.id === profileId) || familyProfiles[0] || null;
  const route = profile?.source === setup.packSource ? "pack" : "native";

  const packRunner = family.runners?.[setup.packSource];
  const pack = packRunner ? nodePack(packRunner.pack) : null;
  const loader = family.slots.length === 2 ? "DualCLIPLoader" : "CLIPLoader";
  const native = online && (!family.clipType || optionsFor(info, loader, "type").includes(family.clipType))
    && (family.requiredNodes || []).every((node) => hasNode(info, node));
  const packPart = online && pack ? missingPackPart(info, packRunner.pack, { detail: packRunner.note }) : null;
  const packLoaded = Boolean(online && pack && !packPart);
  const packReady = packLoaded && (packRunner.requiredNodes || []).every((node) => hasNode(info, node));

  // The encoder and VAE only matter on ComfyUI's own nodes; the makers' folder carries both.
  const parts = [];
  if (route === "native" && online) {
    const encoders = optionsFor(info, "CLIPLoader", "clip_name").map(classifyEncoder);
    const vaes = optionsFor(info, "VAELoader", "vae_name").map(classifyVae);
    const withDisk = (spec, part) => spec && ({ id: spec.id, file: spec.file, folder: spec.folder, label: spec.label, bytes: spec.bytes || 0, url: spec.url, part, onDisk: Boolean(onDisk(spec)) });
    for (const slot of family.slots) {
      const have = rankEncoders(encoders, slot);
      parts.push({ part: "encoder", label: `${slot.label} text encoder`, have: have[0] || "", download: have.length ? null : withDisk(preferredDownload("encoder", slot.download || slot.kinds[0], device), "encoder") });
    }
    const haveVae = rankVaes(vaes, family.vae);
    parts.push({ part: "vae", label: vaeKinds[family.vae[0]]?.label || "VAE", have: haveVae[0] || "", download: haveVae.length ? null : withDisk(preferredDownload("vae", family.vae[0], device), "vae") });
  }

  return {
    family: familyId,
    title: setup.title, maker: setup.maker, blurb: setup.blurb, license: setup.license, page: setup.page, filesPage: setup.filesPage,
    profile: profile ? { id: profile.id, model: profile.model, displayName: profile.displayName, variant: profile.variantLabel || profile.variant, ready: Boolean(profile.ready) } : null,
    route,
    parts,
    comfy: {
      online, version: comfyVersion, native,
      pack: pack ? { id: pack.id, name: pack.name, loaded: packLoaded, ready: packReady, part: packPart } : null
    }
  };
}
