import crypto from "node:crypto";

import { cardKinds, maxCardDescription, maxCardName, maxCards } from "../shared/characters.ts";
import { mayUseFeature } from "./account-policy.js";
import { directRoute } from "./domain/direct-route.ts";
import { dataDir, galleryJobItems } from "./gallery/store.js";
import { minorAgeRefusal } from "./minor-age.js";
import { ownerDocumentName, savedDocument, writeRuntimeDocument } from "./persistence/runtime.ts";
import { referenceAssetMetadataForAccount, referenceExistsForAccount } from "./references.js";
import { localRefusal } from "./route-access.js";

/**
 * Each account's cards of one kind (shared/characters.ts cardKinds), its `<kind>:<key>` document
 * (runtime.ts ownerDocumentName) holding `{ <kind>: [...] }`. A card's images are reference asset
 * IDs the account owns (references.js), never copies.
 */
const document = (kind, ownerId = "") => ownerDocumentName(kind, ownerId);

export function listCards(kind, ownerId = "") {
  const value = savedDocument(dataDir, document(kind, ownerId));
  return Array.isArray(value?.[kind]) ? value[kind] : [];
}

const save = (kind, ownerId, cards) =>
  writeRuntimeDocument(dataDir, document(kind, ownerId), { [kind]: cards });

/** Saves `change(card)` of the account's character `id` and returns it; undefined when it's gone. */
export function updateCharacter(ownerId, id, change) {
  const characters = listCards("characters", ownerId);
  const index = characters.findIndex((character) => character.id === id);
  if (index < 0) return undefined;
  const character = change(characters[index]);
  save("characters", ownerId, characters.with(index, character));
  return character;
}

const assetOf = (account, id) => {
  try {
    return referenceAssetMetadataForAccount(account, id);
  } catch {
    return null;
  }
};

/**
 * A character's sheet as the account sees it: its panels that still exist, as reference assets
 * with their role, and how far Make Sheet has come (`making` until its panels are kept).
 */
function shownSheet(account, sheet) {
  const failed = galleryJobItems(sheet.jobId).some(
    (item) =>
      (item.ownerId || "") === (account?.userId || "") &&
      ["failed", "cancelled"].includes(item.status),
  );
  return {
    jobId: sheet.jobId,
    at: sheet.at,
    status: sheet.panels ? "done" : sheet.error || failed ? "failed" : "making",
    ...(sheet.error ? { error: sheet.error } : {}),
    panels: (sheet.panels || []).flatMap(({ role, referenceId }) => {
      const asset = assetOf(account, referenceId);
      return asset ? [{ ...asset, role }] : [];
    }),
  };
}

/**
 * A card as the account sees it: its images that still exist, as reference assets, and a
 * character's sheet.
 */
export function shownCard(account, character) {
  const references = character.referenceIds.flatMap((id) => {
    const asset = assetOf(account, id);
    return asset ? [asset] : [];
  });
  return {
    ...character,
    references,
    missing: character.referenceIds.length - references.length,
    ...(character.sheet ? { sheet: shownSheet(account, character.sheet) } : {}),
  };
}

class CardError extends Error {
  status = 400;
}

/** The fields a request may set on a `kind` card, checked; images must be references the account owns. */
function cleanCard(kind, account, body) {
  const { name: noun, images } = cardKinds[kind];
  const name = String(body?.name || "").trim();
  const description = String(body?.description || "").trim();
  const ids = Array.isArray(body?.referenceIds) ? [...new Set(body.referenceIds.map(String))] : [];
  if (!name) throw new CardError(`Name the ${noun}.`);
  if (name.length > maxCardName)
    throw new CardError(`Keep the name within ${maxCardName} characters.`);
  if (description.length > maxCardDescription)
    throw new CardError(`Keep the description within ${maxCardDescription} characters.`);
  if (!images.min && !description) throw new CardError(`Describe the ${noun}.`);
  const refusal = minorAgeRefusal(`${name}\n${description}`);
  if (refusal) throw new CardError(refusal);
  if (ids.length < images.min || ids.length > images.max)
    throw new CardError(
      images.min
        ? `Choose ${images.min} to ${images.max} images.`
        : `Choose at most ${images.max} image.`,
    );
  if (!ids.every((id) => referenceExistsForAccount(account, id)))
    throw new CardError("One of those images is gone.");
  return { name, description, referenceIds: ids };
}

/** Saves a new `kind` card for the account from `fields` and returns it; a CardError answers 400. */
export function createCard(account, kind, fields) {
  const ownerId = account?.userId || "";
  const cards = listCards(kind, ownerId);
  if (cards.length >= maxCards) throw new CardError(`An account can keep ${maxCards} ${kind}.`);
  const now = new Date().toISOString();
  const card = {
    id: `${cardKinds[kind].prefix}-${crypto.randomUUID()}`,
    ...cleanCard(kind, account, fields),
    createdAt: now,
    updatedAt: now,
  };
  save(kind, ownerId, [...cards, card]);
  return card;
}

/** Why the account may not use cards, as a route's answer, or null. */
export const refusal = (account) => {
  if (!account) return localRefusal(account);
  if (!mayUseFeature(account, "characters"))
    return { status: 403, payload: { ok: false, error: "Characters are off for this account." } };
  return null;
};

/**
 * Characters, outfits and scenes: list, create, update and delete the account's cards of each kind
 * at `/api/<kind>` (shared with MCP through directRoute), and record a character's Generate
 * References jobs. All behind the Characters feature (account-policy.js).
 */
export function registerCardRoutes(app) {
  /** `run(account, ownerId, input)` once the account may use cards; CardErrors answer 400. */
  const route = (method, path, run) =>
    directRoute(app, method, path, (account, input) => {
      const refused = refusal(account);
      if (refused) return refused;
      try {
        return run(account, account?.userId || "", input);
      } catch (error) {
        if (!(error instanceof CardError)) throw error;
        return { status: error.status, payload: { ok: false, error: error.message } };
      }
    });

  for (const [kind, { name: noun }] of Object.entries(cardKinds)) {
    const missing = { status: 404, payload: { ok: false, error: `No such ${noun}.` } };
    const reply = (status, account, card) => ({
      status,
      payload: { ok: true, [noun]: shownCard(account, card) },
    });

    route("GET", `/api/${kind}`, (account, ownerId) => ({
      status: 200,
      payload: { [kind]: listCards(kind, ownerId).map((card) => shownCard(account, card)) },
    }));

    route("POST", `/api/${kind}`, (account, _ownerId, { body }) =>
      reply(201, account, createCard(account, kind, body)),
    );

    route("PUT", `/api/${kind}/:id`, (account, ownerId, { params, body }) => {
      const cards = listCards(kind, ownerId);
      const index = cards.findIndex((card) => card.id === params.id);
      if (index < 0) return missing;
      const card = {
        ...cards[index],
        ...cleanCard(kind, account, body),
        updatedAt: new Date().toISOString(),
      };
      save(kind, ownerId, cards.with(index, card));
      return reply(200, account, card);
    });

    route("DELETE", `/api/${kind}/:id`, (_account, ownerId, { params }) => {
      const cards = listCards(kind, ownerId);
      const rest = cards.filter((card) => card.id !== params.id);
      if (rest.length === cards.length) return missing;
      save(kind, ownerId, rest);
      return { status: 200, payload: { ok: true } };
    });
  }
}
