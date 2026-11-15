import { Alert, ScrollArea, Stack } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";

import { withoutPart } from "../../../../shared/characters";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import { PickerGrid, PickerTile } from "../generation/Picker";
import {
  type CardParts,
  forgetCard,
  promptCardApplied,
  rememberCard,
  withPromptCard,
} from "./cardParts";
import { PromptCardMenu, promptCardText, usePromptCardDialogs } from "./PromptCardDialogs";
import { type PromptCard, type PromptCardKind, charactersQuery, promptCardsQuery } from "./queries";

/**
 * The References sheet's Outfits and Scenes tabs. Picking a card puts its sentence in the prompt
 * after a character's lead, an outfit before a scene (shared/characters.ts composePrompt), swapping
 * out the kind's other card; picking it again takes it out. `onLayer` hears when a dialog opens.
 */
export function PromptCardChoices({
  kind,
  query,
  prompt,
  parts,
  onChange,
  onLayer,
}: {
  kind: PromptCardKind;
  query: string;
  prompt: string;
  parts?: CardParts;
  onChange: (prompt: string, parts: CardParts) => void;
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
    if (current) return onChange(withoutPart(prompt, current), forgetCard(parts, card.id));
    const next = withPromptCard(kind, card, prompt, {
      cards: listing.data,
      characters: characters.data,
      outfits: outfits.data,
      parts,
    });
    onChange(next, rememberCard(parts, kind, card, next));
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
