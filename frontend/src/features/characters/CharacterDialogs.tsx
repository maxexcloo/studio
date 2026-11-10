import { useState } from "react";
import { ActionIcon, getDefaultZIndex, Menu } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { icons } from "../../ui/icons";
import { menuWidth } from "../../theme";
import { CharacterEditor, type CharacterStart } from "./CharacterEditor";
import { useGeneration } from "../generation/GenerationProvider";
import { profileName } from "../generation/payload";
import { useGenerateReferences } from "./generateReferences";
import { useDeleteCharacter, type CharacterCard } from "./queries";

/**
 * New, Edit and Delete Character and Generate References for a list of cards: `edit` and `remove`
 * open their dialog, which `dialogs` renders. `onLayer` hears when one opens or closes over a sheet.
 */
export function useCharacterDialogs(onLayer: (open: boolean) => void = () => {}) {
  const [editing, setEditing] = useState<{ card?: CharacterCard; start?: CharacterStart }>();
  const [deleting, setDeleting] = useState<CharacterCard | null>(null);
  const deletion = useDeleteCharacter();
  const { profile } = useGeneration();
  const generation = useGenerateReferences(profile?.kind === "image" ? profile.id : undefined);
  const generate = (card: CharacterCard) =>
    generation.mutate(card, {
      onSuccess: ({ profile, jobIds }) =>
        notifications.show({
          title: `Generating ${jobIds.length} References for ${card.name}`,
          message: `With ${profileName(profile)}. Once they finish, pick the ones to keep in Edit Character.`,
        }),
      onError: (error) => notifications.show({ color: "red", message: error.message }),
    });
  const closeEditor = () => {
    setEditing(undefined);
    onLayer(false);
  };
  const closeDelete = () => {
    setDeleting(null);
    onLayer(false);
  };
  return {
    edit: (card?: CharacterCard, start?: CharacterStart) => {
      setEditing({ card, start });
      onLayer(true);
    },
    generate,
    remove: (card: CharacterCard) => {
      deletion.reset();
      setDeleting(card);
      onLayer(true);
    },
    dialogs: (
      <>
        <CharacterEditor
          opened={editing !== undefined}
          character={editing?.card}
          start={editing?.start}
          onClose={closeEditor}
          onGenerate={generate}
          generating={generation.isPending}
        />
        <ConfirmDialog
          opened={deleting !== null}
          title="Delete Character"
          action="Delete Character"
          pending={deletion.isPending}
          error={deletion.error?.message}
          zIndex={getDefaultZIndex("overlay")}
          onConfirm={() => deleting && deletion.mutate(deleting.id, { onSuccess: closeDelete })}
          onClose={closeDelete}
        >
          {`Delete ${deleting?.name}? Its images stay in the gallery.`}
        </ConfirmDialog>
      </>
    ),
  };
}

/** A card's ⋯ menu: Edit Character, Generate References, then Delete Character. */
export function CharacterMenu({
  card,
  onEdit,
  onGenerate,
  onDelete,
  withinPortal = true,
}: {
  card: CharacterCard;
  onEdit: () => void;
  onGenerate: () => void;
  onDelete: () => void;
  /** Off inside a popover, so choosing an item is not a press outside it. */
  withinPortal?: boolean;
}) {
  return (
    <Menu position="bottom-end" width={menuWidth} withinPortal={withinPortal}>
      <Menu.Target>
        <ActionIcon variant="default" aria-label={`Actions for ${card.name}`}>
          <icons.more size={14} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Item leftSection={<icons.edit size={16} />} onClick={onEdit}>
          Edit Character
        </Menu.Item>
        <Menu.Item leftSection={<icons.variations size={16} />} onClick={onGenerate}>
          Generate References
        </Menu.Item>
        <Menu.Item color="red" leftSection={<icons.delete size={16} />} onClick={onDelete}>
          Delete Character
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
