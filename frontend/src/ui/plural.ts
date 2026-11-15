/** A count with its noun, plural unless one ("1 file", "1,200 files"). */
export const plural = (count: number, noun: string) =>
  `${count.toLocaleString()} ${noun}${count === 1 ? "" : "s"}`;
