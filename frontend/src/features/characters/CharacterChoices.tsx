import { Alert, ScrollArea, Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { characterProfiles, keepsIdentity } from "../../../../shared/characters";
import type { Models, Profile, ReferenceAsset } from "../../types";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import { modelsQuery } from "../generation/GenerationProvider";
import { profileName } from "../generation/payload";
import { PickerGrid, PickerTile } from "../generation/Picker";
import { CharacterMenu, useCharacterDialogs } from "./CharacterDialogs";
import {
  type CharacterCard,
  applyCharacter,
  characterApplied,
  charactersQuery,
  removeCharacter,
} from "./queries";

const sheetStatus = { making: "Making Sheet", done: "Sheet", failed: "Sheet Failed" };

/** A card's images and its sheet. */
export function characterDetail(card: CharacterCard) {
  const count = card.references.length;
  return [
    count ? `${count} ${count === 1 ? "image" : "images"}` : "No images",
    card.sheet && sheetStatus[card.sheet.status],
  ]
    .filter(Boolean)
    .join(" · ");
}

/** The model a character moves an img2img-only image draft to: the best that edits with references. */
export function characterEditor(profile: Profile | undefined, models: Models | undefined) {
  if (profile?.kind !== "image" || keepsIdentity(profile)) return undefined;
  return characterProfiles(
    (models?.profiles || []).filter((item) => item.kind === "image" && item.ready !== false),
    [models?.defaults?.imageModel],
  )[0];
}

export const switchedText = (name: string) =>
  `Switched to ${name}, which keeps a character's face and build in new scenes.`;

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
  const editor = switchable ? characterEditor(profile, models.data) : undefined;
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
          {switchedText(switched)}
        </Text>
      )}
      {!editor && profile && !keepsIdentity(profile) && cards.length > 0 && (
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
                    onSheet={() => dialogs.sheet(card)}
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
