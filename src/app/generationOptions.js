/** Restore the workflow that made an output before considering its model file. */
export function outputProfile(profiles = [], item = {}) {
  const candidates = profiles.filter((profile) => profile.kind === item.type);
  const settings = item.settings || {};
  return candidates.find((profile) => profile.id === settings.profileId)
    || candidates.find((profile) => profile.workflow === settings.workflow)
    || candidates.find((profile) => profile.model === item.model);
}

export function profileImageCount(profile, fallback) {
  if (profile.kind === "video" || profile.capabilities?.variations === false) return 1;
  const meta = profile.constraints?.count || {};
  const count = Number(profile.defaults?.count || meta.default || fallback);
  return Math.max(Number(meta.min) || 1, Math.min(Number(meta.max) || 8, count));
}

/** Reference latents multiply memory use: queue each variant separately. */
export function generationPlan({ count = 1, kind, profile, references = [], queueMode }) {
  const effectiveCount = kind === "video" || profile?.capabilities?.variations === false ? 1 : Math.max(1, Math.min(8, Math.round(Number(count) || 1)));
  const separate = kind === "image" && (queueMode === "separate" || references.length > 0);
  return { effectiveCount, separate, imageRuns: separate ? effectiveCount : 1, requestCount: separate ? 1 : effectiveCount };
}

/** Use the workflow's own canvas unless its family selects a starting preset. */
export function profileImageSize(profile, kind = profile?.kind || "image") {
  const defaults = profile?.defaults || {};
  const aspect = profile?.aspectPolicy !== "fixed" && profile?.aspectDefault
    ? profile.aspectPresets?.find((item) => item.label === profile.aspectDefault)
    : null;
  const width = Number(defaults.width || (kind === "video" ? 640 : 1024));
  const height = Number(defaults.height || width);
  return aspect ? { width: aspect.w, height: aspect.h } : { width, height };
}
