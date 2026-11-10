import { Alert, ScrollArea, Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import type { Profile, ReferenceAsset } from "../../types";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import { editsReferences } from "../../../../shared/characters";
import { profileName } from "../generation/payload";
import { PickerGrid, PickerTile } from "../generation/Picker";
import { CharacterMenu, useCharacterDialogs } from "./CharacterDialogs";
import {
  applyCharacter,
  characterApplied,
  charactersQuery,
  referenceLimit,
  removeCharacter,
  type CharacterCard,
} from "./queries";

/** A card's images, and how many the profile will take when it takes fewer. */
export function characterDetail(card: CharacterCard, limit?: number) {
  const count = card.references.length;
  if (!count) return "No images";
  if (limit !== undefined && limit < count) return `Uses ${limit} of ${count} images`;
  return `${count} ${count === 1 ? "image" : "images"}`;
}

/**
 * The References sheet's Characters tab: the account's cards and New Character. Picking a card
 * places its images and adds its description to the prompt; picking it again takes both out.
 * `onLayer` hears when a dialog opens over the sheet, which then lets it own focus.
 */
export function CharacterChoices({
  query,
  references,
  prompt,
  profile,
  onChange,
  onLayer,
}: {
  query: string;
  references: ReferenceAsset[];
  prompt: string;
  profile?: Profile;
  onChange: (next: { references: ReferenceAsset[]; prompt: string }) => void;
  onLayer: (open: boolean) => void;
}) {
  const characters = useQuery(charactersQuery);
  const dialogs = useCharacterDialogs(onLayer);
  const limit = referenceLimit(profile);
  const words = query.trim().toLowerCase();
  const cards = (characters.data || []).filter(
    (card) => !words || `${card.name} ${card.description}`.toLowerCase().includes(words),
  );
  if (characters.isPending) return <LoadingState fill label="Loading Characters" />;
  if (characters.error) return <Alert color="red">{characters.error.message}</Alert>;
  return (
    <Stack gap="xs" flex={1} mih={0}>
      {profile && !editsReferences(profile) && cards.length > 0 && (
        <Text size="xs" c="dimmed">
          {`${profileName(profile)} starts from a reference image (img2img), so a character's pose and layout carry over. For new scenes, choose a model that edits with references.`}
        </Text>
      )}
      {cards.some((card) => card.references.length > limit) && (
        <Text size="xs" c="dimmed">
          {`${profile ? profileName(profile) : "This model"} takes ${limit} ${limit === 1 ? "reference" : "references"}, so a card with more adds its first ${limit === 1 ? "image" : limit}.`}
        </Text>
      )}
      <ScrollArea.Autosize style={{ flex: 1, minHeight: 0 }}>
        <PickerGrid label="Character Choices">
          <PickerTile
            label="New Character"
            title="New Character"
            selected={false}
            placeholder={icons.add}
            onToggle={() => dialogs.edit()}
          />
          {cards.map((card) => {
            const applied = characterApplied(card, references, prompt);
            return (
              <PickerTile
                key={card.id}
                label={`${applied ? "Remove" : "Use"} character: ${card.name}`}
                title={card.name}
                detail={characterDetail(card, limit)}
                selected={applied}
                disabled={!card.references.length}
                image={card.references[0]?.thumbnailUrl || card.references[0]?.url}
                placeholder={card.references.length ? undefined : icons.character}
                onToggle={() =>
                  onChange(
                    applied
                      ? removeCharacter(card, references, prompt)
                      : applyCharacter(card, references, prompt, profile),
                  )
                }
                action={
                  <CharacterMenu
                    card={card}
                    withinPortal={false}
                    onEdit={() => dialogs.edit(card)}
                    onGenerate={() => dialogs.generate(card)}
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
