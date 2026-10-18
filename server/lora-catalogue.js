import { loraCompatibility, strengthRange } from './lora-policy.js';

// Local catalogue entries describe installed files; they never become download records.
export function enrichLocalLoraInfo(info, name, catalogue, familiesFromMetadata, families) {
  const entry = Object.hasOwn(catalogue || {}, name) ? catalogue[name] : null;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return info;
  const requested = familiesFromMetadata({ base_model: String(entry.baseModel || '') });
  const detected = info?.families || [];
  const compatible = !detected.length || requested.some((id) => detected.includes(id));
  const ids = requested.length && compatible ? requested : detected;
  const title = typeof entry.title === 'string' ? entry.title.trim().slice(0, 300) : '';
  return {
    ...info,
    ...(title ? { title, about: title } : {}),
    families: ids,
    base: ids.length ? [...new Set(ids.map((id) => families[id]?.label).filter(Boolean))].join(' / ') : info?.base || '',
    ...loraDescriptionMetadata(entry),
    ...loraRoleMetadata(entry),
    ...loraPolicyMetadata(entry),
  };
}

function loraDescriptionMetadata(entry) {
  return {
    ...(typeof entry.description === 'string' ? { description: entry.description.trim().slice(0, 10000) } : {}),
    ...(typeof entry.sourceUrl === 'string' && /^https?:\/\//i.test(entry.sourceUrl) ? { sourceUrl: entry.sourceUrl } : {}),
  };
}

function loraRoleMetadata(entry) {
  return {
    ...(['effect', 'acceleration', 'supporting'].includes(entry.role) ? { role: entry.role } : {}),
    ...(typeof entry.note === 'string' ? { note: entry.note.trim().slice(0, 500) } : {}),
  };
}

// Provider metadata refines architecture detection without changing model filenames.
export function enrichLoraInfo(info, name, sources, familiesFromMetadata, families) {
  const matches = Object.values(sources || {}).filter((source) =>
    /^(?:civitai:\d+:\d+|hf:[^:/\s]+\/[^:/\s]+:[a-f0-9]{40}:[^\r\n]+)$/i.test(source?.id || '')
    && source.folder === 'loras' && source.file === name);
  if (matches.length !== 1) return info;
  const source = matches[0];
  const title = [source.label, source.version].filter((value) => typeof value === 'string' && value.trim()).join(' · ');
  const baseModel = String(source.baseModel || '').replace(/^qwen\s+2\.1$/i, 'Qwen-Image 2.1');
  const providerFamilies = familiesFromMetadata({ base_model: baseModel });
  const detected = info?.families || [];
  const sameArchitecture = !detected.length || providerFamilies.some((id) => detected.includes(id))
    || detected.includes('qwen_image') && providerFamilies.includes('qwen_image_21');
  const ids = providerFamilies.length && sameArchitecture ? providerFamilies : detected;
  const triggers = Array.isArray(source.trainedWords) ? source.trainedWords.filter((value) => typeof value === 'string' && value.trim()).slice(0, 30) : [];
  return {
    ...info,
    ...loraDescriptionMetadata(source),
    ...loraRoleMetadata(source),
    ...loraPolicyMetadata(source),
    ...(title ? { title, about: title } : {}),
    families: ids,
    base: ids.length ? [...new Set(ids.map((id) => families[id]?.label).filter(Boolean))].join(' / ') : info?.base || '',
    triggers: triggers.length ? triggers : info?.triggers || [],
  };
}

/** Saved stacks remain intact, but infrastructure weights must not enter the optional effect stack. */
export function optionalLoraIssue(loras, infos) {
  const item = (loras || []).find((lora) => lora.enabled !== false && ['acceleration', 'supporting'].includes(infos[lora.name]?.role));
  if (!item) return '';
  return `${infos[item.name].title || item.name} is ${infos[item.name].role === 'acceleration' ? 'an acceleration adapter; choose its prepared recipe' : 'a supporting file'} and cannot be used as an optional LoRA. Remove it from this stack to generate. Saved stacks have not been changed.`;
}


function loraPolicyMetadata(entry) {
  const compatibility = entry.compatibility;
  const constraints = compatibility && typeof compatibility === 'object' && !Array.isArray(compatibility)
    ? Object.fromEntries(['baseModels', 'conditionings', 'profileIds'].filter((key) => Object.hasOwn(compatibility, key)).map((key) => [key, Array.isArray(compatibility[key]) ? compatibility[key].filter((value) => typeof value === 'string' && value.trim()).slice(0, 100) : []])) : null;
  return {
    ...(constraints && Object.keys(constraints).length ? { compatibility: { ...constraints, unlisted: compatibility.unlisted === 'other' ? 'other' : 'unknown' } } : {}),
    ...(strengthRange(entry) ? { strengthRange: strengthRange(entry) } : {}),
  };
}

/** Applies only to user-added effects, with the server's resolved profile context. */
export function optionalLoraPolicyIssue(item, info, profile) {
  if (info?.compatibility && loraCompatibility(info, profile) === 'other') return `${info?.title || item.name} does not support this model or conditioning variant. Remove it from the optional LoRA stack to generate.`;
  const range = strengthRange(info);
  if (range && (item.strength < range.min || item.strength > range.max)) return `${info?.title || item.name} supports strength ${range.min} to ${range.max}. Choose a value in that published range.`;
  return '';
}
