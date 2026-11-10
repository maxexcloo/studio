import crypto from "node:crypto";
import {
  maxCharacterDescription,
  maxCharacterImages,
  maxCharacterName,
  maxCharacters,
} from "../shared/characters.ts";
import { mayUseFeature } from "./account-policy.js";
import { directRoute } from "./domain/direct-route.ts";
import { dataDir, galleryJobItems, isGalleryHidden } from "./gallery/store.js";
import { ownerDocumentName, savedDocument, writeRuntimeDocument } from "./persistence/runtime.ts";
import { referenceAssetMetadataForAccount, referenceExistsForAccount } from "./references.js";
import { localRefusal } from "./route-access.js";

/**
 * Each account's character cards, its `characters:<key>` document (runtime.ts ownerDocumentName).
 * A card's images are reference asset IDs the account owns (references.js), never copies.
 */
const document = (ownerId = "") => ownerDocumentName("characters", ownerId);

export function listCharacters(ownerId = "") {
  const value = savedDocument(dataDir, document(ownerId));
  return Array.isArray(value?.characters) ? value.characters : [];
}

const save = (ownerId, characters) =>
  writeRuntimeDocument(dataDir, document(ownerId), { characters });

/** Generate References' results so far, the account's own visible gallery items. */
function generatedResults(ownerId, generated) {
  return generated.jobIds.flatMap((jobId) =>
    galleryJobItems(jobId)
      .filter((item) => (item.ownerId || "") === ownerId && !isGalleryHidden(item))
      .map((item) => ({
        galleryItemId: item.id,
        jobId,
        status: item.status,
        thumbnailUrl: item.thumbnailUrl || item.url || "",
        prompt: item.prompt || "",
      })),
  );
}

/**
 * A card as the account sees it: its images that still exist, as reference assets, and any
 * generated references waiting to be picked.
 */
export function shownCharacter(account, character) {
  const references = character.referenceIds.flatMap((id) => {
    try {
      return [referenceAssetMetadataForAccount(account, id)];
    } catch {
      return [];
    }
  });
  return {
    ...character,
    references,
    missing: character.referenceIds.length - references.length,
    ...(character.generated
      ? {
          generated: {
            ...character.generated,
            results: generatedResults(account?.userId || "", character.generated),
          },
        }
      : {}),
  };
}

/** The account's card by its ID, else by its name (any case), else undefined. */
export function findCharacter(ownerId, value) {
  const wanted = String(value || "").trim();
  const characters = listCharacters(ownerId);
  return (
    characters.find((character) => character.id === wanted) ||
    characters.find((character) => character.name.toLowerCase() === wanted.toLowerCase())
  );
}

class CharacterError extends Error {
  status = 400;
}

/** The fields a request may set, checked; images must be references the account owns. */
function cleanCard(account, body) {
  const name = String(body?.name || "").trim();
  const description = String(body?.description || "").trim();
  const ids = Array.isArray(body?.referenceIds) ? [...new Set(body.referenceIds.map(String))] : [];
  if (!name) throw new CharacterError("Name the character.");
  if (name.length > maxCharacterName)
    throw new CharacterError(`Keep the name within ${maxCharacterName} characters.`);
  if (description.length > maxCharacterDescription)
    throw new CharacterError(`Keep the description within ${maxCharacterDescription} characters.`);
  if (!ids.length || ids.length > maxCharacterImages)
    throw new CharacterError(`Choose 1 to ${maxCharacterImages} images.`);
  if (!ids.every((id) => referenceExistsForAccount(account, id)))
    throw new CharacterError("One of those images is gone.");
  return { name, description, referenceIds: ids };
}

const refusal = (account) => {
  if (!account) return localRefusal(account);
  if (!mayUseFeature(account, "characters"))
    return { status: 403, payload: { ok: false, error: "Characters are off for this account." } };
  return null;
};

/**
 * Characters: list, create, update and delete the account's cards (shared with MCP through
 * directRoute). Behind the Characters feature (account-policy.js).
 */
export function registerCharacterRoutes(app) {
  /** `run(account, ownerId, input)` once the account may use characters; CharacterErrors answer 400. */
  const route = (method, path, run) =>
    directRoute(app, method, path, (account, input) => {
      const refused = refusal(account);
      if (refused) return refused;
      try {
        return run(account, account?.userId || "", input);
      } catch (error) {
        if (!(error instanceof CharacterError)) throw error;
        return { status: error.status, payload: { ok: false, error: error.message } };
      }
    });
  const shown = (account, ownerId) =>
    listCharacters(ownerId).map((character) => shownCharacter(account, character));

  route("GET", "/api/characters", (account, ownerId) => ({
    status: 200,
    payload: { characters: shown(account, ownerId) },
  }));

  route("POST", "/api/characters", (account, ownerId, { body }) => {
    const characters = listCharacters(ownerId);
    if (characters.length >= maxCharacters)
      throw new CharacterError(`An account can keep ${maxCharacters} characters.`);
    const now = new Date().toISOString();
    const character = {
      id: `chr-${crypto.randomUUID()}`,
      ...cleanCard(account, body),
      createdAt: now,
      updatedAt: now,
    };
    save(ownerId, [...characters, character]);
    return { status: 201, payload: { ok: true, character: shownCharacter(account, character) } };
  });

  route("PUT", "/api/characters/:id", (account, ownerId, { params, body }) => {
    const characters = listCharacters(ownerId);
    const index = characters.findIndex((character) => character.id === params.id);
    if (index < 0) return { status: 404, payload: { ok: false, error: "No such character." } };
    // Saving the card is where generated references are picked, so it ends their wait.
    const { generated: _picked, ...kept } = characters[index];
    const character = {
      ...kept,
      ...cleanCard(account, body),
      updatedAt: new Date().toISOString(),
    };
    save(ownerId, characters.with(index, character));
    return { status: 200, payload: { ok: true, character: shownCharacter(account, character) } };
  });

  // Generate References queued these jobs (the app's and MCP's generate); the card lists their
  // results until it is next saved.
  route("POST", "/api/characters/:id/generated", (account, ownerId, { params, body }) => {
    const characters = listCharacters(ownerId);
    const index = characters.findIndex((character) => character.id === params.id);
    if (index < 0) return { status: 404, payload: { ok: false, error: "No such character." } };
    const jobIds = Array.isArray(body?.jobIds) ? body.jobIds.map(String) : [];
    if (!jobIds.length || jobIds.length > 8 || !jobIds.every((id) => /^[\w-]{1,100}$/.test(id)))
      throw new CharacterError("Pass the 1 to 8 jobs Generate References queued.");
    const character = {
      ...characters[index],
      generated: { jobIds, at: new Date().toISOString() },
    };
    save(ownerId, characters.with(index, character));
    return { status: 200, payload: { ok: true, character: shownCharacter(account, character) } };
  });

  route("DELETE", "/api/characters/:id", (_account, ownerId, { params }) => {
    const characters = listCharacters(ownerId);
    const rest = characters.filter((character) => character.id !== params.id);
    if (rest.length === characters.length)
      return { status: 404, payload: { ok: false, error: "No such character." } };
    save(ownerId, rest);
    return { status: 200, payload: { ok: true } };
  });
}
