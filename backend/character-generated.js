import { ownerDocuments, writeRuntimeDocument } from "./persistence/runtime.ts";

/**
 * The migrate-runtime step that drops the `generated` field Generate References left on characters,
 * listing the jobs whose results waited to be picked. Generate References is gone; its results stay
 * in the gallery. Plans by default; `apply` writes. A second run finds nothing.
 */
export function characterGenerated(dataDir, { apply = false } = {}) {
  const documents = ownerDocuments(dataDir, "characters").filter(({ value }) =>
    value.characters?.some((card) => card.generated),
  );
  const cards = documents.flatMap(({ value }) =>
    value.characters
      .filter((card) => card.generated)
      .map((card) => ({ id: card.id, name: card.name, jobs: card.generated.jobIds.length })),
  );
  if (apply)
    for (const { name, value } of documents)
      writeRuntimeDocument(dataDir, name, {
        ...value,
        characters: value.characters.map(({ generated: _generated, ...card }) => card),
      });
  return { applied: apply, characters: cards.length, cards };
}
