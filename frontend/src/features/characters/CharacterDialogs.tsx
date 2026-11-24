import { ActionIcon, Menu, getDefaultZIndex } from "@mantine/core";
import { useState } from "react";

import { menuWidth } from "../../theme";
import { ActionMenuItems } from "../../ui/ActionBar";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { icons } from "../../ui/icons";
import { PopupTooltip } from "../../ui/PopupTooltip";
import { itemAction, itemActionGroups } from "../gallery/itemActions";
import { CharacterEditor, type CharacterStart } from "./CharacterEditor";
import { CharacterFaceCheck } from "./CharacterFaceCheck";
import { type CharacterCard, useDeleteCharacter, useMakeSheet } from "./queries";
import { useCardRating } from "./useCardRating";

/**
 * New, Edit and Delete Character, Make Sheet and Face Check for a list of cards: `edit`,
 * `faceCheck` and `remove` open their dialog, which `dialogs` renders. `onLayer` hears when one
 * opens or closes over a sheet. A sheet in the making shows on its card.
 */
export function useCharacterDialogs(onLayer: (open: boolean) => void = () => {}) {
  const [editing, setEditing] = useState<{ card?: CharacterCard; start?: CharacterStart }>();
  const [deleting, setDeleting] = useState<CharacterCard | null>(null);
  const [checking, setChecking] = useState<CharacterCard | null>(null);
  const deletion = useDeleteCharacter();
  const making = useMakeSheet();
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
    sheet: (card: CharacterCard) => making.mutate(card),
    faceCheck: (card: CharacterCard) => {
      setChecking(card);
      onLayer(true);
    },
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
        />
        <CharacterFaceCheck
          card={checking}
          onClose={() => {
            setChecking(null);
            onLayer(false);
          }}
        />
        <ConfirmDialog
          opened={deleting !== null}
          title="Delete Character"
          action="Delete"
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

/** A card's ⋯ menu: Edit Character, Make Sheet, Face Check, rating and Delete Character. */
export function CharacterMenu({
  card,
  onEdit,
  onSheet,
  onFaceCheck,
  onDelete,
  withinPortal = true,
}: {
  card: CharacterCard;
  onEdit: () => void;
  onSheet: () => void;
  onFaceCheck: () => void;
  onDelete: () => void;
  /** Off inside a popover, so choosing an item is not a press outside it. */
  withinPortal?: boolean;
}) {
  const ratings = useCardRating("characters", card);
  return (
    <Menu position="bottom-end" width={menuWidth} withinPortal={withinPortal}>
      <PopupTooltip label="Actions">
        <Menu.Target>
          <ActionIcon variant="default" aria-label={`Actions for ${card.name}`}>
            <icons.more size={14} />
          </ActionIcon>
        </Menu.Target>
      </PopupTooltip>
      <Menu.Dropdown>
        <ActionMenuItems
          groups={[
            [
              { id: "edit", label: "Edit", icon: icons.edit, onClick: onEdit },
              {
                id: "sheet",
                label: "Make Sheet",
                icon: icons.sheet,
                disabled: !card.references.length || card.sheet?.status === "making",
                onClick: onSheet,
              },
              {
                id: "face-check",
                label: "Face Check",
                icon: icons.character,
                onClick: onFaceCheck,
              },
            ],
            ...itemActionGroups([
              ...ratings,
              itemAction("delete", { label: "Delete", onClick: onDelete }),
            ]),
          ]}
        />
      </Menu.Dropdown>
    </Menu>
  );
}
