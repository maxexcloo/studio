/** Structured filters shared by paginated galleries and the in-memory Hidden view. */
export function matchesGalleryFilters(item, filters = {}) {
  if (item.status === 'pending') return true;
  const settings = item.settings || {};
  const fields = {
    lora: (Array.isArray(settings.loras) ? settings.loras : []).map((lora) => lora?.name),
    model: [item.model, settings.modelName],
    workflow: [settings.workflow, settings.profileId],
  };
  return Object.entries(fields).every(([key, values]) => {
    const term = String(filters[key] || '').trim().toLowerCase();
    return !term || values.some((value) => typeof value === 'string' && value.toLowerCase().includes(term));
  });
}
