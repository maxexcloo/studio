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
    ...(title ? { title, about: title } : {}),
    families: ids,
    base: ids.length ? [...new Set(ids.map((id) => families[id]?.label).filter(Boolean))].join(' / ') : info?.base || '',
    triggers: triggers.length ? triggers : info?.triggers || [],
    ...(source.sourceUrl ? { sourceUrl: source.sourceUrl } : {}),
  };
}
