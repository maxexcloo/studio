import { notifications } from "@mantine/notifications";

import type { Profile } from "../../types";
import {
  type Draft,
  defaultProfile,
  draftForProfile,
  useGeneration,
} from "../generation/GenerationProvider";
import { useOpenComposer } from "../generation/openComposer";
import {
  isProfile,
  profileForBackend,
  profileName,
  referenceDetails,
  referencePatch,
} from "../generation/payload";
import { orderedReferences } from "../generation/references";
import { promptCardApplied, rememberCard, withPromptCard } from "./cardParts";
import { characterEditor, switchedText } from "./CharacterChoices";
import {
  type CharacterCard,
  type PromptCard,
  type PromptCardKind,
  applyCharacter,
  characterApplied,
} from "./queries";

/**
 * Library's Use in Composer: stages a card in the image composer's draft as picking it in the
 * References sheet does, then opens the composer. A card already in the draft stays as it is.
 */
export function useCardInComposer() {
  const { changeKind, setDraft, profiles, models } = useGeneration();
  const openComposer = useOpenComposer();
  function stage(update: (draft: Draft, profile?: Profile) => Draft) {
    changeKind("image");
    setDraft((previous) => {
      const selected = previous.input.profileId
        ? profiles.find((profile) => isProfile(profile, previous.input.profileId))
        : defaultProfile(models.data, "image");
      return update(previous, profileForBackend(selected, previous.input.profileBackend, true));
    });
    openComposer("image");
  }
  return {
    character(card: CharacterCard) {
      let switched = "";
      stage((draft, profile) => {
        const prompt = String(draft.input.prompt || "");
        const references = orderedReferences(
          referenceDetails(draft.references, draft.input, profile),
          profile,
        );
        if (characterApplied(card, references, prompt, draft.input.cardParts)) return draft;
        const editor = characterEditor(profile, models.data);
        const next = applyCharacter(
          card,
          references,
          prompt,
          editor || profile,
          draft.input.cardParts,
        );
        if (editor) {
          switched = profileName(editor);
          return draftForProfile(draft, editor, next);
        }
        return {
          ...draft,
          references: next.references,
          input: {
            ...draft.input,
            prompt: next.prompt,
            cardParts: next.cardParts,
            ...referencePatch(draft.input, draft.references, next.references, profile),
          },
        };
      });
      if (switched) notifications.show({ message: switchedText(switched) });
    },
    promptCard(kind: PromptCardKind, card: PromptCard) {
      stage((draft) => {
        const prompt = String(draft.input.prompt || "");
        if (promptCardApplied(kind, card, prompt, draft.input.cardParts)) return draft;
        const next = withPromptCard(kind, card, prompt, draft.input.cardParts);
        return {
          ...draft,
          input: {
            ...draft.input,
            prompt: next,
            cardParts: rememberCard(draft.input.cardParts, kind, card, prompt, next),
          },
        };
      });
    },
  };
}
