import { useState } from "react";
import { ActionIcon, Alert, getDefaultZIndex, Menu, ScrollArea, Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import type { Profile, ReferenceAsset } from "../../types";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import { menuWidth } from "../../theme";
import { profileName } from "../generation/payload";
import { PickerGrid, PickerTile } from "../generation/Picker";
import { CharacterEditor } from "./CharacterEditor";
import {
  applyCharacter,
  characterApplied,
  charactersQuery,
  referenceLimit,
  removeCharacter,
  useDeleteCharacter,
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
  const [editing, setEditing] = useState<CharacterCard | "new" | null>(null);
  const [deleting, setDeleting] = useState<CharacterCard | null>(null);
  const deletion = useDeleteCharacter();
  const limit = referenceLimit(profile);
  const words = query.trim().toLowerCase();
  const cards = (characters.data || []).filter(
    (card) => !words || `${card.name} ${card.description}`.toLowerCase().includes(words),
  );
  const layer = (open: boolean) => onLayer(open);
  if (characters.isPending) return <LoadingState fill label="Loading Characters" />;
  if (characters.error) return <Alert color="red">{characters.error.message}</Alert>;
  return (
    <Stack gap="xs" flex={1} mih={0}>
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
            onToggle={() => {
              setEditing("new");
              layer(true);
            }}
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
                  <Menu position="bottom-end" width={menuWidth} withinPortal={false}>
                    <Menu.Target>
                      <ActionIcon variant="default" aria-label={`Actions for ${card.name}`}>
                        <icons.more size={14} />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      <Menu.Item
                        leftSection={<icons.edit size={16} />}
                        onClick={() => {
                          setEditing(card);
                          layer(true);
                        }}
                      >
                        Edit Character
                      </Menu.Item>
                      <Menu.Item
                        color="red"
                        leftSection={<icons.delete size={16} />}
                        onClick={() => {
                          deletion.reset();
                          setDeleting(card);
                          layer(true);
                        }}
                      >
                        Delete Character
                      </Menu.Item>
                    </Menu.Dropdown>
                  </Menu>
                }
              />
            );
          })}
        </PickerGrid>
      </ScrollArea.Autosize>
      <CharacterEditor
        opened={editing !== null}
        character={editing === "new" ? undefined : editing || undefined}
        onClose={() => {
          setEditing(null);
          layer(false);
        }}
      />
      <ConfirmDialog
        opened={deleting !== null}
        title="Delete Character"
        action="Delete Character"
        pending={deletion.isPending}
        error={deletion.error?.message}
        zIndex={getDefaultZIndex("overlay")}
        onConfirm={() =>
          deleting &&
          deletion.mutate(deleting.id, {
            onSuccess: () => {
              setDeleting(null);
              layer(false);
            },
          })
        }
        onClose={() => {
          setDeleting(null);
          layer(false);
        }}
      >
        {`Delete ${deleting?.name}? Its images stay in the gallery.`}
      </ConfirmDialog>
    </Stack>
  );
}
