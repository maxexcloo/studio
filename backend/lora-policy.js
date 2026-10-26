const constraintKeys = ["baseModels", "conditionings", "profileIds"];
const familyId = (value) => {
  const id = String(value || "").replace(/-/g, "_");
  return id === "flux3_klein" ? "flux3" : id;
};
const basename = (value) =>
  String(value || "")
    .split(/[\\/]/)
    .pop();

/** Only a known shared family carries the current stack into another model. */
export function sameLoraFamily(previous, next) {
  if (previous?.id && previous.id === next?.id) return true;
  const family = familyId(previous?.family);
  return Boolean(family && family !== "custom" && family === familyId(next?.family));
}

/**
 * A LoRA's friendly name: the catalogue's title, else its file name cleaned
 * up (no folder or extension, spaces for underscores and hyphens, Title
 * Case), so people never read "pawg_krea2.safetensors". Shared by the studio
 * and MCP replies.
 */
export function loraName(name, info) {
  const title = typeof info?.title === "string" ? info.title.trim() : "";
  if (title) return title;
  const stem = basename(name)
    .replace(/\.(safetensors|ckpt|pt|pth|bin|gguf)$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return stem.replace(/(^|\s)([a-z])/g, (_, space, letter) => space + letter.toUpperCase());
}

/** Explicit publisher targets refine family compatibility; unverified variants stay unknown. */
export function loraCompatibility(info, profile) {
  const family = familyId(profile?.family);
  if (!info?.families?.length || !family || family === "custom") return "unknown";
  if (!info.families.some((value) => familyId(value) === family)) return "other";
  const constraints = info.compatibility;
  if (!constraints) return "fits";
  const model = profile?.baseModel || profile?.defaults?.model || profile?.model;
  const context = {
    baseModels: /^custom:/.test(String(model || "")) ? "" : basename(model),
    conditionings: profile?.recipe?.conditioning,
    profileIds: profile?.id,
  };
  let unknown = false;
  for (const key of constraintKeys) {
    if (!Object.hasOwn(constraints, key)) continue;
    if (!context[key]) {
      unknown = true;
      continue;
    }
    const allowed = constraints[key] || [];
    if (
      !allowed.some((value) => (key === "baseModels" ? basename(value) : value) === context[key])
    ) {
      if (constraints.unlisted === "other") return "other";
      unknown = true;
    }
  }
  return unknown ? "unknown" : "fits";
}

/**
 * A LoRA stack without the entries that cannot run on this profile ('other': trained for another
 * family, or a variant its publisher excludes). Unverified ('unknown') entries stay. `infos` maps a
 * LoRA name to its info, or is a function from name to info. Entries keep their shape and order.
 * For reused settings: the server refuses 'other' LoRAs on submit, so drop them first and say how many.
 */
export function compatibleLoras(loras, infos, profile) {
  const infoOf =
    typeof infos === "function"
      ? infos
      : (name) => (infos && Object.hasOwn(infos, name) ? infos[name] : undefined);
  const kept = [];
  const droppedNames = [];
  for (const item of Array.isArray(loras) ? loras : []) {
    const name = typeof item === "string" ? item : item?.name;
    if (name && loraCompatibility(infoOf(name), profile) === "other") droppedNames.push(name);
    else kept.push(item);
  }
  return { loras: kept, dropped: droppedNames.length, droppedNames };
}

/** Only explicit full publisher bounds replace existing controls; recommendations stay prose. */
export function strengthRange(info) {
  const range = info?.strengthRange;
  if (
    !range ||
    !Number.isFinite(range.min) ||
    !Number.isFinite(range.max) ||
    range.min >= range.max
  )
    return null;
  if (!Number.isFinite(range.step) || range.step <= 0 || range.step > range.max - range.min)
    return null;
  return {
    min: range.min,
    max: range.max,
    step: range.step,
    ...(Number.isFinite(range.default) && range.default >= range.min && range.default <= range.max
      ? { default: range.default }
      : {}),
  };
}

export function compatibilityNote(info, profile) {
  if (!info?.compatibility) return "";
  const fit = loraCompatibility(info, profile);
  return fit === "unknown"
    ? "Compatibility has not been verified for this model variant."
    : fit === "other"
      ? "This LoRA does not support the selected model variant."
      : "";
}
