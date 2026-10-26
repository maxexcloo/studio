import { loraCompatibility, strengthRange } from "./lora-policy.js";

// Local catalogue entries describe installed files; they never become download records.
export function enrichLocalLoraInfo(info, name, catalogue, familiesFromMetadata, families) {
  const entry = Object.hasOwn(catalogue || {}, name) ? catalogue[name] : null;
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return info;
  const requested = familiesFromMetadata({ base_model: String(entry.baseModel || "") });
  const detected = info?.families || [];
  // Qwen-Image 2.1 LoRAs read as Qwen-Image from their weights alone; the catalogue says which.
  const compatible =
    !detected.length ||
    requested.some((id) => detected.includes(id)) ||
    (detected.includes("qwen_image") && requested.includes("qwen_image_21"));
  const ids = requested.length && compatible ? requested : detected;
  const title = typeof entry.title === "string" ? entry.title.trim().slice(0, 300) : "";
  return {
    ...info,
    ...(title ? { title, about: title } : {}),
    families: ids,
    base: ids.length
      ? [...new Set(ids.map((id) => families[id]?.label).filter(Boolean))].join(" / ")
      : info?.base || "",
    ...loraDescriptionMetadata(entry),
    ...loraRoleMetadata(entry),
    ...loraPolicyMetadata(entry),
    ...(Array.isArray(entry.triggers) ? { triggers: cleanTriggers(entry.triggers) } : {}),
    ...(typeof entry.guidance === "string" && entry.guidance.trim()
      ? { guidance: entry.guidance.trim().slice(0, 1000) }
      : {}),
    ...loraPromptMetadata(entry),
  };
}

/** How the LoRA wants its prompt (lora-prompts.js): its style, up to 10 tags, and a negative of its own (reserved). */
export function loraPromptMetadata(entry) {
  const tags = (Array.isArray(entry?.tags) ? entry.tags : [])
    .filter((tag) => typeof tag === "string" && tag.trim())
    .map((tag) => tag.trim().slice(0, 80))
    .slice(0, 10);
  return {
    ...(["tags", "natural", "mixed"].includes(entry?.promptStyle)
      ? { promptStyle: entry.promptStyle }
      : {}),
    ...(tags.length ? { tags } : {}),
    ...(typeof entry?.negative === "string" && entry.negative.trim()
      ? { negative: entry.negative.trim().slice(0, 500) }
      : {}),
  };
}

/** Trigger words, without blanks or a literal "[]" some providers list for "none". */
export function cleanTriggers(values) {
  return (Array.isArray(values) ? values : [])
    .filter((value) => typeof value === "string" && value.trim() && value.trim() !== "[]")
    .map((value) => value.trim())
    .slice(0, 30);
}

function loraDescriptionMetadata(entry) {
  return {
    ...(typeof entry.description === "string"
      ? { description: entry.description.trim().slice(0, 10000) }
      : {}),
    ...(typeof entry.sourceUrl === "string" && /^https?:\/\//i.test(entry.sourceUrl)
      ? { sourceUrl: entry.sourceUrl }
      : {}),
  };
}

function loraRoleMetadata(entry) {
  return {
    ...(["slider", "style", "character", "concept"].includes(entry.type)
      ? { type: entry.type }
      : {}),
    ...(["effect", "acceleration", "supporting"].includes(entry.role) ? { role: entry.role } : {}),
    ...(typeof entry.note === "string" ? { note: entry.note.trim().slice(0, 500) } : {}),
  };
}

// Provider metadata refines architecture detection without changing model filenames.
export function enrichLoraInfo(info, name, sources, familiesFromMetadata, families) {
  const matches = Object.values(sources || {}).filter(
    (source) =>
      /^(?:civitai:\d+:\d+|hf:[^:/\s]+\/[^:/\s]+:[a-f0-9]{40}:[^\r\n]+)$/i.test(source?.id || "") &&
      source.folder === "loras" &&
      source.file === name,
  );
  if (matches.length !== 1) return info;
  const source = matches[0];
  const title = [source.label, source.version]
    .filter((value) => typeof value === "string" && value.trim())
    .join(" · ");
  const baseModel = String(source.baseModel || "").replace(/^qwen\s+2\.1$/i, "Qwen-Image 2.1");
  const providerFamilies = familiesFromMetadata({ base_model: baseModel });
  const detected = info?.families || [];
  const sameArchitecture =
    !detected.length ||
    providerFamilies.some((id) => detected.includes(id)) ||
    (detected.includes("qwen_image") && providerFamilies.includes("qwen_image_21"));
  const ids = providerFamilies.length && sameArchitecture ? providerFamilies : detected;
  const triggers = cleanTriggers(source.trainedWords);
  return {
    ...info,
    ...loraDescriptionMetadata(source),
    ...loraRoleMetadata(source),
    ...loraPolicyMetadata(source),
    ...(title ? { title, about: title } : {}),
    families: ids,
    base: ids.length
      ? [...new Set(ids.map((id) => families[id]?.label).filter(Boolean))].join(" / ")
      : info?.base || "",
    triggers: triggers.length ? triggers : cleanTriggers(info?.triggers),
  };
}

/** Saved stacks remain intact, but infrastructure weights must not enter the optional effect stack. */
export function optionalLoraIssue(loras, infos) {
  const item = (loras || []).find(
    (lora) =>
      lora.enabled !== false && ["acceleration", "supporting"].includes(infos[lora.name]?.role),
  );
  if (!item) return "";
  return `${infos[item.name].title || item.name} is ${infos[item.name].role === "acceleration" ? "an acceleration adapter; choose its prepared recipe" : "a supporting file"} and cannot be used as an optional LoRA. Remove it from this stack to generate. Saved stacks have not been changed.`;
}

function loraPolicyMetadata(entry) {
  const compatibility = entry.compatibility;
  const constraints =
    compatibility && typeof compatibility === "object" && !Array.isArray(compatibility)
      ? Object.fromEntries(
          ["baseModels", "conditionings", "profileIds"]
            .filter((key) => Object.hasOwn(compatibility, key))
            .map((key) => [
              key,
              Array.isArray(compatibility[key])
                ? compatibility[key]
                    .filter((value) => typeof value === "string" && value.trim())
                    .slice(0, 100)
                : [],
            ]),
        )
      : null;
  return {
    ...(constraints && Object.keys(constraints).length
      ? {
          compatibility: {
            ...constraints,
            unlisted: compatibility.unlisted === "other" ? "other" : "unknown",
          },
        }
      : {}),
    ...(strengthRange(entry) ? { strengthRange: strengthRange(entry) } : {}),
  };
}

/** Applies only to user-added effects, with the server's resolved profile context. */
export function optionalLoraPolicyIssue(item, info, profile) {
  if (loraCompatibility(info, profile) === "other") {
    // Another family entirely, or a variant the publisher excludes within this family.
    const family =
      loraCompatibility({ families: info?.families }, profile) === "other"
        ? info?.base || info.families.join(" / ")
        : "";
    return family
      ? `${info?.title || item.name} is for ${family}, not ${profile?.displayName || profile?.label || "this model"}. Remove it from the optional LoRA stack to generate.`
      : `${info?.title || item.name} does not support this model or conditioning variant. Remove it from the optional LoRA stack to generate.`;
  }
  const range = strengthRange(info);
  if (range && (item.strength < range.min || item.strength > range.max))
    return `${info?.title || item.name} supports strength ${range.min} to ${range.max}. Choose a value in that published range.`;
  return "";
}
