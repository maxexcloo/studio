const word = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

/**
 * What a proposed prompt changed in the one it replaces, in a few words ("midday → golden hour ·
 * + a slight smile"), or "" where they share less than half their words, as an edit instruction or a whole rewrite.
 */
export function changeSummary(before: string, after: string, limit = 80) {
  const a = before.split(/\s+/).filter(Boolean);
  const b = after.split(/\s+/).filter(Boolean);
  const keyA = a.map(word);
  const keyB = b.map(word);
  // The longest common run of words, from the end, so the walk below reads forwards.
  const width = b.length + 1;
  const common = new Uint16Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      common[i * width + j] =
        keyA[i] === keyB[j]
          ? common[(i + 1) * width + j + 1] + 1
          : Math.max(common[(i + 1) * width + j], common[i * width + j + 1]);
  if (common[0] * 2 < Math.max(a.length, b.length)) return "";
  const hunks: { removed: string[]; added: string[] }[] = [];
  let hunk: (typeof hunks)[number] | null = null;
  for (let i = 0, j = 0; i < a.length || j < b.length;) {
    if (i < a.length && j < b.length && keyA[i] === keyB[j]) {
      hunk = null;
      i++;
      j++;
      continue;
    }
    if (!hunk) hunks.push((hunk = { removed: [], added: [] }));
    if (j < b.length && (i >= a.length || common[i * width + j + 1] >= common[(i + 1) * width + j]))
      hunk.added.push(b[j++]);
    else hunk.removed.push(a[i++]);
  }
  const summary = hunks
    .map(({ removed, added }) => {
      const gone = removed.join(" ").replace(/[,;:.]+$/, "");
      const now = added.join(" ").replace(/[,;:.]+$/, "");
      return gone && now ? `${gone} → ${now}` : now ? `+ ${now}` : `− ${gone}`;
    })
    .join(" · ");
  return summary.length <= limit ? summary : `${summary.slice(0, limit - 1).trimEnd()}…`;
}
