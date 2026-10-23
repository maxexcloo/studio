const names: Record<string, string> = {
  auraflow: "Pony V7 / AuraFlow",
  flux: "Flux",
  hidream: "HiDream I1",
  hunyuan15: "HunyuanVideo 1.5",
  hunyuan15_i2v: "HunyuanVideo 1.5 I2V",
  mage_flow: "MageFlow",
  minimax_h3: "MiniMax H3",
  moss_image: "MOSS Image",
  nf4: "bitsandbytes NF4",
  qwen_image: "Qwen Image",
  qwen_image_21: "Qwen Image 2.1",
  sd15: "SD 1.5",
  sd2: "SD 2.x",
  sd3: "SD 3.5",
  sdxl: "SDXL",
  svdq: "Nunchaku SVDQuant",
  wan21: "Wan 2.1",
  wan22_14b: "Wan 2.2 14B",
  wan22_14b_i2v: "Wan 2.2 14B I2V",
  wan22_5b: "Wan 2.2 5B",
  z_image: "Z-Image",
  zimage: "Z-Image",
};

/** Human labels only: stored family identifiers still own compatibility. */
export function modelFamilyLabel(family = "", familyName?: string): string {
  const label = (familyName || family).trim();
  if (!label) return "Unclassified";
  const flux = /^flux[. _-]?(\d+)/i.exec(label);
  if (flux) return `Flux ${flux[1]}`;
  if (familyName && /[A-Z]/.test(familyName) && !familyName.includes("_"))
    return label.replace(/^qwen[- ]image/i, "Qwen Image").replace(/^moss[- ]image/i, "MOSS Image");
  const key = label.toLowerCase().replace(/[- ]/g, "_");
  return (
    names[key] ||
    label
      .replace(/[_-]+/g, " ")
      .replace(/([a-z])(\d)/g, "$1 $2")
      .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
  );
}
