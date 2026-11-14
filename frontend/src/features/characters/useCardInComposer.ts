import { notifications } from "@mantine/notifications";
import { useQuery } from "@tanstack/react-query";
import type { Profile } from "../../types";
import {
  defaultProfile,
  draftForProfile,
  useGeneration,
  type Draft,
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
import { characterEditor, switchedText } from "./CharacterChoices";
import { promptCardApplied, withPromptCard } from "./PromptCardChoices";
import {
  applyCharacter,
  characterApplied,
  charactersQuery,
  promptCardsQuery,
  type CharacterCard,
  type PromptCard,
  type PromptCardKind,
} from "./queries";

/**
 * Library's Use in Composer: stages a card in the image composer's draft as picking it in the
 * References sheet does, then opens the composer. A card already in the draft stays as it is.
 */
export function useCardInComposer() {
  const { changeKind, setDraft, profiles, models } = useGeneration();
  const openComposer = useOpenComposer();
  const characters = useQuery(charactersQuery);
  const outfits = useQuery(promptCardsQuery("outfits"));
  const scenes = useQuery(promptCardsQuery("scenes"));
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
        if (characterApplied(card, references, prompt)) return draft;
        const editor = characterEditor(profile, models.data);
        const next = applyCharacter(card, references, prompt, editor || profile);
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
            ...referencePatch(draft.input, draft.references, next.references, profile),
          },
        };
      });
      if (switched) notifications.show({ message: switchedText(switched) });
    },
    promptCard(kind: PromptCardKind, card: PromptCard) {
      stage((draft) => {
        const prompt = String(draft.input.prompt || "");
        if (promptCardApplied(kind, card, prompt)) return draft;
        const lists = { characters: characters.data, outfits: outfits.data };
        const cards = kind === "outfits" ? outfits.data : scenes.data;
        return {
          ...draft,
          input: {
            ...draft.input,
            prompt: withPromptCard(kind, card, prompt, { ...lists, cards }),
          },
        };
      });
    },
  };
}
