/** "image" or "video", for wording about one gallery item. */
export const itemNoun = (item) => item?.type === "video" ? "video" : "image";

/** The top bar's line while generations run, naming one image or one video. */
export function generatingLabel(count, items = []) {
  if (count !== 1) return `Generating ${count}`;
  return `Generating 1 ${itemNoun(items.find((item) => item.status === "pending"))}`;
}
