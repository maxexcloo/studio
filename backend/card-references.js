import { randomInt } from "node:crypto";

import { cardKinds, referenceCandidates, referencePrompt } from "../shared/characters.ts";
import {
  CardError,
  checkCardAge,
  checkRoom,
  cleanCard,
  createCard,
  editCard,
  listCards,
  refusal,
  shownCard,
} from "./cards.js";
import { directRoute } from "./domain/direct-route.ts";
import { storedChatRecord } from "./gallery/records.js";

/**
 * Generate References: a card's candidates drawn from its name and description (shared/characters.ts
 * referencePrompt) as one comparison, each with its own seed, on the image profile the caller
 * chose. The card is saved as sent and waits on the comparison (`candidates`), whose pick joins its
 * images (cards.js addPickedReference). `profiles(account)` are the profiles the account may use;
 * `queue` is domain/compare.ts's.
 */
export function registerCardReferenceRoutes(app, { profiles, queue }) {
  for (const [kind, { name: noun }] of Object.entries(cardKinds)) {
    directRoute(app, "POST", `/api/${kind}/references`, async (account, { body }) => {
      const refused = refusal(account);
      if (refused) return refused;
      const ownerId = account?.userId || "";
      const id = typeof body?.id === "string" ? body.id : "";
      try {
        const { description } = cleanCard(kind, account, body, true);
        await checkCardAge(kind, body);
        if (!description) throw new CardError(`Describe the ${noun} to draw it.`);
        if (id && !listCards(kind, ownerId).some((card) => card.id === id))
          return { status: 404, payload: { ok: false, error: `No such ${noun}.` } };
        if (!id) checkRoom(kind, ownerId);
        const profile = (await profiles(account)).find(
          (each) => each.id === body?.profileId && each.kind === "image" && each.ready !== false,
        );
        if (!profile) throw new CardError("Choose a ready image model.");
        const chat = storedChatRecord(body?.chat);
        const input = {
          ...profile.defaults,
          kind: "image",
          profileId: profile.id,
          ...(profile.backend ? { profileBackend: profile.backend } : {}),
          model: profile.model,
          workflow: profile.workflow,
          loras: [],
          referenceAssets: [],
          prompt: referencePrompt(kind, description),
          negative: "",
          count: 1,
          ...(chat ? { chat } : {}),
        };
        const queued = await queue(account, {
          variants: Array.from({ length: referenceCandidates }, () => {
            const seed = String(randomInt(2 ** 32));
            return { label: `Seed ${seed}`, input: { ...input, seed } };
          }),
        });
        if (queued.status >= 400) return queued;
        const comparison = queued.payload;
        const card = id
          ? editCard(account, kind, id, body, comparison.id)
          : createCard(account, kind, body, comparison.id);
        return {
          status: 201,
          payload: { ok: true, [noun]: shownCard(account, card), comparison },
        };
      } catch (error) {
        if (!(error instanceof CardError)) throw error;
        return { status: error.status, payload: { ok: false, error: error.message } };
      }
    });
  }
}
