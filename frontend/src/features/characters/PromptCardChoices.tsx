import { Alert, ScrollArea, Stack } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import {
  characterLead,
  outfitPart,
  scenePart,
  withPart,
  withoutPart,
} from "../../../../shared/characters";
import { PickerGrid, PickerTile } from "../generation/Picker";
import { PromptCardMenu, promptCardText, usePromptCardDialogs } from "./PromptCardDialogs";
import {
  charactersQuery,
  promptCardsQuery,
  type CharacterCard,
  type PromptCard,
  type PromptCardKind,
} from "./queries";

/** The sentences a card may stand as in a prompt: a scene's differs with a character's image. */
const partsOf = (kind: PromptCardKind, card: PromptCard) =>
  kind === "outfits"
    ? [outfitPart(card.description)]
    : [scenePart(card.description, true), scenePart(card.description)];

/** The sentence `card` stands as in `prompt`, if it is there. */
export const promptCardApplied = (kind: PromptCardKind, card: PromptCard, prompt: string) =>
  partsOf(kind, card).find((part) => prompt.includes(part));

/**
 * `prompt` with `card`'s sentence after a character's lead, an outfit before a scene, in place of
 * the kind's other `cards`.
 */
export function withPromptCard(
  kind: PromptCardKind,
  card: PromptCard,
  prompt: string,
  lists: { cards?: PromptCard[]; characters?: CharacterCard[]; outfits?: PromptCard[] },
) {
  const leads = (lists.characters || [])
    .map((character) => characterLead(character.description))
    .filter((lead) => prompt.includes(lead));
  const cleared = (lists.cards || []).reduce(
    (text, other) => partsOf(kind, other).reduce(withoutPart, text),
    prompt,
  );
  const before =
    kind === "outfits"
      ? leads
      : [...leads, ...(lists.outfits || []).map((outfit) => outfitPart(outfit.description))];
  const part =
    kind === "outfits"
      ? outfitPart(card.description)
      : scenePart(card.description, leads.length > 0);
  return withPart(cleared, part, before);
}

/**
 * The References sheet's Outfits and Scenes tabs. Picking a card puts its sentence in the prompt
 * after a character's lead, an outfit before a scene (shared/characters.ts composePrompt), swapping
 * out the kind's other card; picking it again takes it out. `onLayer` hears when a dialog opens.
 */
export function PromptCardChoices({
  kind,
  query,
  prompt,
  onChange,
  onLayer,
}: {
  kind: PromptCardKind;
  query: string;
  prompt: string;
  onChange: (prompt: string) => void;
  onLayer: (open: boolean) => void;
}) {
  const { noun } = promptCardText[kind];
  const listing = useQuery(promptCardsQuery(kind));
  const characters = useQuery(charactersQuery);
  const outfits = useQuery(promptCardsQuery("outfits"));
  const dialogs = usePromptCardDialogs(kind, onLayer);
  const words = query.trim().toLowerCase();
  const cards = (listing.data || []).filter(
    (card) => !words || `${card.name} ${card.description}`.toLowerCase().includes(words),
  );
  if (listing.isPending) return <LoadingState fill label={`Loading ${noun}s`} />;
  if (listing.error) return <Alert color="red">{listing.error.message}</Alert>;
  const applied = (card: PromptCard) => promptCardApplied(kind, card, prompt);
  function toggle(card: PromptCard) {
    const current = applied(card);
    if (current) return onChange(withoutPart(prompt, current));
    onChange(
      withPromptCard(kind, card, prompt, {
        cards: listing.data,
        characters: characters.data,
        outfits: outfits.data,
      }),
    );
  }
  return (
    <Stack gap="xs" flex={1} mih={0}>
      <ScrollArea.Autosize style={{ flex: 1, minHeight: 0 }}>
        <PickerGrid label={`${noun} Choices`}>
          <PickerTile
            label={`New ${noun}`}
            title={`New ${noun}`}
            selected={false}
            placeholder={icons.add}
            onToggle={() => dialogs.edit()}
          />
          {cards.map((card) => {
            const on = Boolean(applied(card));
            return (
              <PickerTile
                key={card.id}
                label={`${on ? "Remove" : "Use"} ${noun.toLowerCase()}: ${card.name}`}
                title={card.name}
                detail={card.description}
                selected={on}
                placeholder={kind === "outfits" ? icons.outfit : icons.scene}
                onToggle={() => toggle(card)}
                action={
                  <PromptCardMenu
                    kind={kind}
                    card={card}
                    withinPortal={false}
                    onEdit={() => dialogs.edit(card)}
                    onDelete={() => dialogs.remove(card)}
                  />
                }
              />
            );
          })}
        </PickerGrid>
      </ScrollArea.Autosize>
      {dialogs.dialogs}
    </Stack>
  );
}
