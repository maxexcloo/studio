/** A run of words both texts share, or that only the old (`removed`) or new (`added`) one has. */
export interface DiffPart {
  text: string;
  change?: "removed" | "added";
}

/** The word-by-word difference from `before` to `after`, keeping each text's spacing. */
export function wordDiff(before: string, after: string): DiffPart[] {
  const a = before.split(/(?<=\s)(?=\S)/).filter(Boolean);
  const b = after.split(/(?<=\s)(?=\S)/).filter(Boolean);
  const word = (token: string) => token.trim();
  // The longest common subsequence's length from each pair of positions to the end.
  const common = Array.from({ length: a.length + 1 }, () =>
    Array.from({ length: b.length + 1 }, () => 0),
  );
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      common[i][j] =
        word(a[i]) === word(b[j])
          ? common[i + 1][j + 1] + 1
          : Math.max(common[i + 1][j], common[i][j + 1]);
  const parts: DiffPart[] = [];
  const push = (text: string, change?: DiffPart["change"]) => {
    const last = parts.at(-1);
    if (last && last.change === change) last.text += text;
    else parts.push(change ? { text, change } : { text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && word(a[i]) === word(b[j])) {
      push(b[j]);
      i++;
      j++;
    } else if (i < a.length && (j === b.length || common[i + 1][j] >= common[i][j + 1]))
      push(a[i++], "removed");
    else push(b[j++], "added");
  }
  return parts;
}
