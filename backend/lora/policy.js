import { loraCompatibility } from "../../shared/profiles.ts";

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

/** Published bounds use the usual control increment unless the publisher gives one. */
export function strengthRange(info) {
  const range = info?.strengthRange;
  if (
    !range ||
    !Number.isFinite(range.min) ||
    !Number.isFinite(range.max) ||
    range.min >= range.max
  )
    return null;
  const step = range.step ?? Math.min(0.05, range.max - range.min);
  if (!Number.isFinite(step) || step <= 0 || step > range.max - range.min) return null;
  return {
    min: range.min,
    max: range.max,
    step,
    ...(Number.isFinite(range.default) && range.default >= range.min && range.default <= range.max
      ? { default: range.default }
      : {}),
  };
}
