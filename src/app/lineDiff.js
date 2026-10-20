/**
 * A line diff for the profile editor's review: equal lines, removals and
 * additions in order, from the longest common run of lines. Unchanged runs
 * longer than `context` lines either side of a change fold into one `skip`.
 */
export function lineDiff(before, after, { context = 3 } = {}) {
  const a = String(before ?? '').replace(/\n$/, '').split('\n');
  const b = String(after ?? '').replace(/\n$/, '').split('\n');
  // Trim the shared start and end first: edits are usually small and local.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length, endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA -= 1; endB -= 1; }
  const midA = a.slice(start, endA), midB = b.slice(start, endB);
  const rows = midA.length + 1, cols = midB.length + 1;
  const ops = [];
  if (rows * cols > 4_000_000) {
    // Too large to align line by line: everything between the shared ends changed.
    for (const line of midA) ops.push({ type: 'remove', text: line });
    for (const line of midB) ops.push({ type: 'add', text: line });
  } else {
    const table = Array.from({ length: rows }, () => new Uint32Array(cols));
    for (let i = midA.length - 1; i >= 0; i -= 1) for (let j = midB.length - 1; j >= 0; j -= 1) {
      table[i][j] = midA[i] === midB[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
    let i = 0, j = 0;
    while (i < midA.length || j < midB.length) {
      if (i < midA.length && j < midB.length && midA[i] === midB[j]) { ops.push({ type: 'same', text: midA[i] }); i += 1; j += 1; }
      // Removals come before additions where either would do, so a changed line reads old then new.
      else if (i < midA.length && (j >= midB.length || table[i + 1][j] >= table[i][j + 1])) { ops.push({ type: 'remove', text: midA[i] }); i += 1; }
      else { ops.push({ type: 'add', text: midB[j] }); j += 1; }
    }
  }
  const all = [...a.slice(0, start).map((text) => ({ type: 'same', text })), ...ops, ...a.slice(endA).map((text) => ({ type: 'same', text }))];
  // Line numbers in the old and new text, for the gutter.
  let oldLine = 0, newLine = 0;
  const numbered = all.map((op) => {
    if (op.type !== 'add') oldLine += 1;
    if (op.type !== 'remove') newLine += 1;
    return { ...op, oldLine: op.type === 'add' ? 0 : oldLine, newLine: op.type === 'remove' ? 0 : newLine };
  });
  const near = numbered.map(() => false);
  numbered.forEach((op, index) => { if (op.type !== 'same') for (let k = Math.max(0, index - context); k <= Math.min(numbered.length - 1, index + context); k += 1) near[k] = true; });
  const out = [];
  for (let index = 0; index < numbered.length; index += 1) {
    if (near[index]) { out.push(numbered[index]); continue; }
    let count = 0;
    while (index < numbered.length && !near[index]) { count += 1; index += 1; }
    index -= 1;
    out.push({ type: 'skip', count });
  }
  return { lines: out, added: ops.filter((op) => op.type === 'add').length, removed: ops.filter((op) => op.type === 'remove').length };
}
