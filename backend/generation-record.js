/**
 * What Studio sends ComfyUI with each run (extra_data.studio_generation), read
 * back from its queue and history to recover jobs.
 */
export function generationRecord(extraData) {
  return extraData?.studio_generation || {};
}
