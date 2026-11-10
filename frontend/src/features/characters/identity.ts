import type { MediaItem } from "../../types";

/** Face Check's finding for a result made with a character, in words; `name` is the character's. */
export function identityNote(
  { score, faces, drifted }: NonNullable<MediaItem["identity"]>,
  name: string,
) {
  const similarity = score === null ? "" : ` (face similarity ${score.toFixed(2)})`;
  if (faces > 1)
    return `${name} may appear ${faces === 2 ? "twice" : `${faces} times`}: the image shows ${faces} faces${similarity}.`;
  if (score === null) return `No face to compare with ${name}.`;
  return drifted
    ? `Looks like someone else, not ${name}${similarity}.`
    : `The same face as ${name}${similarity}.`;
}
