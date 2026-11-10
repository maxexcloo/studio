import { Alert, ScrollArea, Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { Profile, ReferenceAsset } from "../../types";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import { characterProfiles, editsReferences } from "../../../../shared/characters";
import { modelsQuery } from "../generation/GenerationProvider";
import { profileName } from "../generation/payload";
import { PickerGrid, PickerTile } from "../generation/Picker";
import { CharacterMenu, useCharacterDialogs } from "./CharacterDialogs";
import {
  applyCharacter,
  characterApplied,
  charactersQuery,
  removeCharacter,
  type CharacterCard,
} from "./queries";

/** A card's images. */
export function characterDetail(card: CharacterCard) {
  const count = card.references.length;
  if (!count) return "No images";
  return `${count} ${count === 1 ? "image" : "images"}`;
}

/**
 * The References sheet's Characters tab: the account's cards and New Character. Picking a card
 * places its first image and leads the prompt with it; picking it again takes both out. Where the
 * sheet may change the model (`switchable`, the composer's draft), a card picked on an img2img-only
 * image model moves to the best one that edits with references, given back as `profile`.
 * `onLayer` hears when a dialog opens over the sheet, which then lets it own focus.
 */
export function CharacterChoices({
  query,
  references,
  prompt,
  profile,
  switchable = false,
  onChange,
  onLayer,
}: {
  query: string;
  references: ReferenceAsset[];
  prompt: string;
  profile?: Profile;
  switchable?: boolean;
  onChange: (next: { references: ReferenceAsset[]; prompt: string; profile?: Profile }) => void;
  onLayer: (open: boolean) => void;
}) {
  const characters = useQuery(charactersQuery);
  const models = useQuery(modelsQuery);
  const [switched, setSwitched] = useState("");
  const editor =
    switchable && profile?.kind === "image" && !editsReferences(profile)
      ? characterProfiles(
          (models.data?.profiles || []).filter(
            (item) => item.kind === "image" && item.ready !== false,
          ),
          [models.data?.defaults?.imageModel],
        )[0]
      : undefined;
  const dialogs = useCharacterDialogs(onLayer);
  const words = query.trim().toLowerCase();
  const cards = (characters.data || []).filter(
    (card) => !words || `${card.name} ${card.description}`.toLowerCase().includes(words),
  );
  if (characters.isPending) return <LoadingState fill label="Loading Characters" />;
  if (characters.error) return <Alert color="red">{characters.error.message}</Alert>;
  return (
    <Stack gap="xs" flex={1} mih={0}>
      {switched && (
        <Text size="xs" c="dimmed">
          {`Switched to ${switched}, which keeps a character's face and build in new scenes.`}
        </Text>
      )}
      {!editor && profile && !editsReferences(profile) && cards.length > 0 && (
        <Text size="xs" c="dimmed">
          {`${profileName(profile)} starts from a reference image (img2img), so a character's pose and layout carry over. For new scenes, choose a model that edits with references.`}
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
                detail={characterDetail(card)}
                selected={applied}
                disabled={!card.references.length}
                image={card.references[0]?.thumbnailUrl || card.references[0]?.url}
                placeholder={card.references.length ? undefined : icons.character}
                onToggle={() => {
                  if (applied) return onChange(removeCharacter(card, references, prompt));
                  if (editor) setSwitched(profileName(editor));
                  onChange({
                    ...applyCharacter(card, references, prompt, editor || profile),
                    profile: editor,
                  });
                }}
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
