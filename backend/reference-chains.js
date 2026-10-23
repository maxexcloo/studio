/**
 * Synced workflows usually list a reference stack as separate slots
 * ("reference", "reference-2", … each "Reference Image") without saying they
 * belong together. A slot that repeats the one before it (same kind, same role,
 * the same label once a trailing number is dropped) follows it, so the composer
 * shows one References button for the stack. Start and end frames keep their
 * own slots.
 */
export function chainReferenceSlots(inputs) {
  const base = (label) =>
    String(label || "")
      .trim()
      .toLowerCase()
      .replace(/\s*\d+$/, "")
      .replace(/\s+image$/, "");
  inputs.forEach((input, index) => {
    const previous = inputs[index - 1];
    if (!previous || input.follows || input.role === "start" || input.role === "end") return;
    if (
      previous.kind === input.kind &&
      previous.role === input.role &&
      base(previous.label) === base(input.label)
    )
      input.follows = previous.id;
  });
  return inputs;
}
