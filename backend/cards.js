import crypto from "node:crypto";

import {
  cardKinds,
  characterTraits,
  maxCardDescription,
  maxCardName,
  maxCards,
  maxCharacterAge,
  maxCharacterTrait,
  minCharacterAge,
} from "../shared/characters.ts";
import { mayUseFeature } from "./account-policy.js";
import { dataDir } from "./data-dir.js";
import { directRoute } from "./domain/direct-route.ts";
import { galleryJobItems } from "./gallery/store.js";
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

/** Saves `change(card)` of the account's `kind` card `id` and returns it; undefined when it's gone. */
export function updateCard(kind, ownerId, id, change) {
  const cards = listCards(kind, ownerId);
  const index = cards.findIndex((card) => card.id === id);
  if (index < 0) return undefined;
  const card = change(cards[index]);
  save(kind, ownerId, cards.with(index, card));
  return card;
}

/** The account's card waiting on the comparison `comparisonId` (Generate References), with its kind. */
export function cardOf(ownerId, comparisonId) {
  for (const kind of Object.keys(cardKinds)) {
    const card = listCards(kind, ownerId).find((each) => each.candidates === comparisonId);
    if (card) return { kind, card };
  }
}

/**
 * Adds the pick `itemId` of a card's Generate References comparison to its images: after them
 * where there is room, in place of a one-image card's image.
 */
export function addPickedReference(ownerId, comparisonId, itemId) {
  const found = cardOf(ownerId, comparisonId);
  if (!found || found.card.referenceIds.includes(itemId)) return;
  const { max } = cardKinds[found.kind].images;
  if (max > 1 && found.card.referenceIds.length >= max) return;
  updateCard(found.kind, ownerId, found.card.id, (current) => ({
    ...current,
    referenceIds: max > 1 ? [...current.referenceIds, itemId] : [itemId],
    updatedAt: new Date().toISOString(),
  }));
}

const assetOf = (account, id) => {
  try {
    return referenceAssetMetadataForAccount(account, id);
  } catch {
    return null;
  }
};

/** Whether any of the account's results of `jobId` failed or was cancelled. */
const jobFailed = (account, jobId) =>
  galleryJobItems(jobId).some(
    (item) =>
      (item.ownerId || "") === (account?.userId || "") &&
      ["failed", "cancelled"].includes(item.status),
  );

/**
 * A character's sheet as the account sees it: its panels that still exist, as reference assets
 * with their role, and how far Make Sheet has come (`making` until its panels are kept).
 */
function shownSheet(account, sheet) {
  const failed = jobFailed(account, sheet.jobId);
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
 * A card as the account sees it: its images that still exist, as reference assets, a character's
 * portrait while it is made and its sheet.
 */
export function shownCard(account, character) {
  const references = character.referenceIds.flatMap((id) => {
    const asset = assetOf(account, id);
    return asset ? [asset] : [];
  });
  return {
    ...character,
    rating: character.rating ?? null,
    references,
    missing: character.referenceIds.length - references.length,
    ...(character.portrait
      ? {
          portrait: {
            jobId: character.portrait.jobId,
            status: jobFailed(account, character.portrait.jobId) ? "failed" : "making",
          },
        }
      : {}),
    ...(character.sheet ? { sheet: shownSheet(account, character.sheet) } : {}),
  };
}

export class CardError extends Error {
  status = 400;
}

/** A character's age and story (shared/characters.ts characterTraits), checked; empty ones are left out. */
function cleanTraits(body) {
  const traits = {};
  for (const key of characterTraits) {
    const value = String(body?.[key] || "").trim();
    if (value.length > maxCharacterTrait)
      throw new CardError(`Keep the ${key} within ${maxCharacterTrait} characters.`);
    if (value) traits[key] = value;
  }
  if (body?.age !== undefined && body.age !== null && body.age !== "") {
    const age = Number(body.age);
    if (!Number.isInteger(age) || age < minCharacterAge || age > maxCharacterAge)
      throw new CardError(`Give an age from ${minCharacterAge} to ${maxCharacterAge}.`);
    traits.age = age;
  }
  return traits;
}

/** Refuses a card whose text codes someone as under 18 (minor-age.js), before it's saved. */
export async function checkCardAge(kind, body) {
  const traits = kind === "characters" ? cleanTraits(body) : {};
  const text = [body?.name, body?.description].map((value) => String(value || "").trim());
  const refusal = await minorAgeRefusal([...text, ...Object.values(traits)].join("\n"));
  if (refusal) throw new CardError(refusal);
}

/**
 * The fields a request may set on a `kind` card, checked; images must be references the account
 * owns. A character waiting on its portrait or candidates (`pending`) may have none yet.
 */
export function cleanCard(kind, account, body, pending = false) {
  const { name: noun, images } = cardKinds[kind];
  const name = String(body?.name || "").trim();
  const description = String(body?.description || "").trim();
  const traits = kind === "characters" ? cleanTraits(body) : {};
  const ids = Array.isArray(body?.referenceIds) ? [...new Set(body.referenceIds.map(String))] : [];
  if (!name) throw new CardError(`Name the ${noun}.`);
  if (name.length > maxCardName)
    throw new CardError(`Keep the name within ${maxCardName} characters.`);
  if (description.length > maxCardDescription)
    throw new CardError(`Keep the description within ${maxCardDescription} characters.`);
  if (!images.min && !description) throw new CardError(`Describe the ${noun}.`);
  if ((ids.length < images.min && !(pending && !ids.length)) || ids.length > images.max)
    throw new CardError(
      images.min
        ? `Choose ${images.min} to ${images.max} images.`
        : `Choose at most ${images.max} image.`,
    );
  if (!ids.every((id) => referenceExistsForAccount(account, id)))
    throw new CardError("One of those images is gone.");
  return { name, description, ...traits, referenceIds: ids };
}

/** Refuses a new `kind` card where the account keeps as many as it may. */
export function checkRoom(kind, ownerId) {
  if (listCards(kind, ownerId).length >= maxCards)
    throw new CardError(`An account can keep ${maxCards} ${kind}.`);
}

/**
 * Saves a new `kind` card for the account from `fields` and returns it; a CardError answers 400. A
 * new character may wait on a portrait job of the account's (`portrait: { jobId, sheet }`), which
 * becomes its first image (character-sheets.js), or on the comparison `candidates` whose pick
 * becomes one (card-references.js).
 */
export function createCard(account, kind, fields, candidates = "") {
  const ownerId = account?.userId || "";
  checkRoom(kind, ownerId);
  const jobId = kind === "characters" ? String(fields?.portrait?.jobId || "") : "";
  if (jobId && !/^[\w-]{1,100}$/.test(jobId)) throw new CardError("That portrait job is unknown.");
  const now = new Date().toISOString();
  const card = {
    id: `${cardKinds[kind].prefix}-${crypto.randomUUID()}`,
    ...cleanCard(kind, account, fields, Boolean(jobId || candidates)),
    ...(jobId ? { portrait: { jobId, ...(fields.portrait.sheet ? { sheet: true } : {}) } } : {}),
    ...(candidates ? { candidates } : {}),
    createdAt: now,
    updatedAt: now,
  };
  save(kind, ownerId, [...listCards(kind, ownerId), card]);
  return card;
}

/**
 * Saves `fields` over the account's `kind` card `id` and returns it, undefined when it's gone; with
 * `candidates`, the card waits on that comparison (card-references.js).
 */
export function editCard(account, kind, id, fields, candidates = "") {
  const ownerId = account?.userId || "";
  const cards = listCards(kind, ownerId);
  const index = cards.findIndex((card) => card.id === id);
  if (index < 0) return undefined;
  // A character's story is replaced by what is sent, and images end a portrait's wait.
  const { age: _age, ...kept } = cards[index];
  for (const key of characterTraits) delete kept[key];
  if (fields?.referenceIds?.length) delete kept.portrait;
  if (candidates) kept.candidates = candidates;
  const card = {
    ...kept,
    ...cleanCard(kind, account, fields, Boolean(kept.portrait || kept.candidates)),
    updatedAt: new Date().toISOString(),
  };
  save(kind, ownerId, cards.with(index, card));
  return card;
}

/** Deletes one of the account's `kind` cards; answers whether it was there. */
export function deleteCard(ownerId, kind, id) {
  const cards = listCards(kind, ownerId);
  const rest = cards.filter((card) => card.id !== id);
  if (rest.length === cards.length) return false;
  save(kind, ownerId, rest);
  return true;
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
    directRoute(app, method, path, async (account, input) => {
      const refused = refusal(account);
      if (refused) return refused;
      try {
        return await run(account, account?.userId || "", input);
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

    route("POST", `/api/${kind}`, async (account, _ownerId, { body }) => {
      await checkCardAge(kind, body);
      return reply(201, account, createCard(account, kind, body));
    });

    route("PUT", `/api/${kind}/:id`, async (account, _ownerId, { params, body }) => {
      await checkCardAge(kind, body);
      const card = editCard(account, kind, params.id, body);
      return card ? reply(200, account, card) : missing;
    });

    route("PATCH", `/api/${kind}/:id`, (account, ownerId, { params, body }) => {
      const rating = body?.rating;
      if (rating !== null && rating !== "liked" && rating !== "disliked")
        throw new CardError("Choose liked, disliked or null.");
      const cards = listCards(kind, ownerId);
      const index = cards.findIndex((card) => card.id === params.id);
      if (index < 0) return missing;
      const previous = cards[index];
      if ((previous.rating ?? null) === rating) return reply(200, account, previous);
      const { rating: _rating, ...fields } = previous;
      const card = {
        ...fields,
        ...(rating && { rating }),
        updatedAt: new Date().toISOString(),
      };
      save(kind, ownerId, cards.with(index, card));
      return reply(200, account, card);
    });

    route("DELETE", `/api/${kind}/:id`, (_account, ownerId, { params }) =>
      deleteCard(ownerId, kind, params.id) ? { status: 200, payload: { ok: true } } : missing,
    );
  }
}
