/**
 * What Studio sends ComfyUI with each run (extra_data.studio_generation), read
 * back from its queue and history to recover jobs. Runs queued before the
 * hard fork carry it as heiss_generation.
 */
export function generationRecord(extraData) {
  return extraData?.studio_generation || extraData?.heiss_generation || {};
}
