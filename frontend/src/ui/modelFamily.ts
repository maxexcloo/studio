// Names the catalogue doesn't define: quantisation formats and older family ids.
const names: Record<string, string> = {
  flux: "Flux",
  nf4: "bitsandbytes NF4",
  svdq: "Nunchaku SVDQuant",
  z_image: "Z-Image",
};
// The catalogue's own family names (backend/family-catalog.js), from the models list.
let catalogue: Record<string, string> = {};

/** Takes the family names served with the models list (GenerationProvider's modelsQuery). */
export function setFamilyLabels(labels: Record<string, string> = {}) {
  catalogue = labels;
}

/** Human labels only: stored family identifiers still own compatibility. */
export function modelFamilyLabel(family = "", familyName?: string): string {
  const label = (familyName || family).trim();
  if (!label) return "Unclassified";
  if (!familyName && catalogue[family]) return catalogue[family];
  const flux = /^flux[. _-]?(\d+)/i.exec(label);
  if (flux) return `Flux ${flux[1]}`;
  // A written family name (a profile's own, such as "Qwen-Image") is shown as written.
  if (familyName && /[A-Z]/.test(familyName) && !familyName.includes("_")) return label;
  const key = label.toLowerCase().replace(/[- ]/g, "_");
  return (
    names[key] ||
    label
      .replace(/[_-]+/g, " ")
      .replace(/([a-z])(\d)/g, "$1 $2")
      .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
  );
}
