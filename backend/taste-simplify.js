import { maxTastePrefer, tasteLimits } from "../shared/taste.ts";
import { ruleBans } from "./domain/dream-concepts.ts";
import { ownerDocuments, writeRuntimeDocument } from "./persistence/runtime.ts";

/** The person's own taste fields Taste no longer has, which this step moves. */
const retired = ["likes", "avoid", "styles", "note", "rules", "models", "loras", "shapes", "tags"];
const favouriteKinds = ["models", "loras", "shapes", "tags"];
const kept = (entry) =>
  Array.isArray(entry)
    ? entry.length
    : entry && typeof entry === "object"
      ? Object.keys(entry).length
      : entry;

/**
 * The migrate-runtime step that moves each account's retired taste fields (domain/taste.ts) into
 * the simplified Taste: their own Dislikes (`avoid`) and the rules that only ban ("never CGI") join
 * Exclusions; other rules and their own likes, styles and note join My Preferences (`prefer`), one
 * line each; their own models, LoRAs, shapes and tags become Favourites. The plan lists each
 * account's changes; an account whose Exclusions or My Preferences would overflow is a conflict,
 * and a conflict applies nothing. Safe while Studio runs: each taste document is read and written
 * in one turn. Plans by default; `apply` writes. A second run finds nothing.
 */
export function tasteSimplify(dataDir, { apply = false } = {}) {
  const accounts = [];
  const conflicts = [];
  const changed = [];
  for (const { name, value } of ownerDocuments(dataDir, "taste")) {
    const old = value?.preferences ?? {};
    if (!retired.some((key) => Object.hasOwn(old, key))) continue;
    const exclusions = [...(old.exclusions ?? [])];
    const added = [];
    const exclude = (entry) => {
      if (exclusions.some((other) => other.toLowerCase() === entry.toLowerCase())) return;
      exclusions.push(entry);
      added.push(entry);
    };
    const lines = [];
    for (const entry of old.avoid ?? []) exclude(entry);
    for (const rule of old.rules ?? []) {
      const bans = ruleBans(rule);
      if (bans) bans.forEach(exclude);
      else lines.push(rule);
    }
    if (old.likes?.length) lines.push(`Likes: ${old.likes.join(", ")}.`);
    if (old.styles?.length) lines.push(`Styles: ${old.styles.join(", ")}.`);
    if (old.note) lines.push(old.note);
    const prefer = [old.prefer, ...lines].filter(Boolean).join("\n");
    const moved = favouriteKinds.filter((kind) => old[kind]?.length);
    const favourites = { ...old.favourites };
    for (const kind of moved)
      favourites[kind] = [...new Set([...(favourites[kind] ?? []), ...old[kind]])];
    const account = name.slice("taste:".length);
    accounts.push({
      account,
      ...(added.length && { exclusions: added }),
      ...(lines.length && { preferences: lines }),
      ...(moved.length && {
        favourites: Object.fromEntries(moved.map((kind) => [kind, old[kind]])),
      }),
    });
    if (exclusions.length > tasteLimits.exclusions)
      conflicts.push(
        `${account}: Exclusions would hold ${exclusions.length}, over ${tasteLimits.exclusions}.`,
      );
    if (prefer.length > maxTastePrefer)
      conflicts.push(
        `${account}: My Preferences would run to ${prefer.length} characters, over ${maxTastePrefer}.`,
      );
    const preferences = Object.fromEntries(
      Object.entries({ ...old, prefer, favourites, exclusions }).filter(
        ([key, entry]) => !retired.includes(key) && kept(entry),
      ),
    );
    changed.push({ name, value: { ...value, preferences } });
  }
  const applied = apply && !conflicts.length;
  if (applied) for (const { name, value } of changed) writeRuntimeDocument(dataDir, name, value);
  return { applied, accounts, conflicts };
}
