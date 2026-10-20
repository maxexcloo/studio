/** "image" or "video", for wording about one gallery item. */
export const itemNoun = (item) => item?.type === "video" ? "video" : "image";

/** The confirmation before one item is deleted or removed. */
export function deleteConfirmation(item) {
  const noun = itemNoun(item);
  if (item.privateVault) return { title: "Delete from Hidden?", description: `This ${noun} and any upscale are erased. There’s no other copy.`, action: "Delete", destructive: true };
  if (item.library) return { title: "Remove from Gallery?", description: "The file stays in its folder.", action: "Remove" };
  return { title: `Delete This ${noun === "video" ? "Video" : "Image"}?`, description: "The file is deleted from disk.", action: "Delete", destructive: true };
}

/** The top bar's line while generations run, naming one image or one video. */
export function generatingLabel(count, items = []) {
  if (count !== 1) return `Generating ${count}`;
  return `Generating 1 ${itemNoun(items.find((item) => item.status === "pending"))}`;
}
