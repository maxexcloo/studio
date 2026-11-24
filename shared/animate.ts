/** How many Animate modifiers one clip may switch on, wherever they are chosen or admitted. */
export const maxModifiers = 3;

export function animationModifierIds(value: unknown): string[] {
  return [
    ...new Set(
      (Array.isArray(value) ? value : []).map((id) => String(id || "").trim()).filter(Boolean),
    ),
  ].slice(0, maxModifiers);
}
