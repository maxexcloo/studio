import { ActionIcon, Alert, Button, Menu, getDefaultZIndex } from "@mantine/core";
import { useState } from "react";

import { cardKinds } from "../../../../shared/characters";
import { menuWidth } from "../../theme";
import type { ReferenceAsset } from "../../types";
import { ActionMenuItems } from "../../ui/ActionBar";
import { ConfirmDialog, DialogFooter } from "../../ui/ConfirmDialog";
import { icons } from "../../ui/icons";
import { CardDialog, CardFields, CardForm } from "./CardImages";
import {
  type PromptCard,
  type PromptCardKind,
  useDeletePromptCard,
  useSavePromptCard,
} from "./queries";

/** Each kind's words: its name in titles, and what its description should hold. */
export const promptCardText = {
  outfits: {
    noun: "Outfit",
    hint: "Clothes and footwear. Without footwear, the image's shoes or bare feet carry over.",
    placeholder: "A yellow raincoat, dark jeans and black rubber boots",
  },
  scenes: {
    noun: "Scene",
    hint: "Place, light and time. Replaces a character image's own background.",
    placeholder: "A rainy city street at night under neon signs",
  },
} as const;

/**
 * New, Edit and Delete for outfit or scene cards: `edit` and `remove` open their dialog, which
 * `dialogs` renders. `onLayer` hears when one opens or closes over a sheet.
 */
export function usePromptCardDialogs(
  kind: PromptCardKind,
  onLayer: (open: boolean) => void = () => {},
) {
  const { noun } = promptCardText[kind];
  const [editing, setEditing] = useState<{ card?: PromptCard }>();
  const [deleting, setDeleting] = useState<PromptCard | null>(null);
  const deletion = useDeletePromptCard(kind);
  const closeEditor = () => {
    setEditing(undefined);
    onLayer(false);
  };
  const closeDelete = () => {
    setDeleting(null);
    onLayer(false);
  };
  return {
    edit: (card?: PromptCard) => {
      setEditing({ card });
      onLayer(true);
    },
    remove: (card: PromptCard) => {
      deletion.reset();
      setDeleting(card);
      onLayer(true);
    },
    dialogs: (
      <>
        <CardDialog
          opened={editing !== undefined}
          onClose={closeEditor}
          title={`${editing?.card ? "Edit" : "New"} ${noun}`}
        >
          {editing && (
            <PromptCardForm
              key={editing.card?.id || "new"}
              kind={kind}
              card={editing.card}
              onClose={closeEditor}
            />
          )}
        </CardDialog>
        <ConfirmDialog
          opened={deleting !== null}
          title={`Delete ${noun}`}
          action={`Delete ${noun}`}
          pending={deletion.isPending}
          error={deletion.error?.message}
          zIndex={getDefaultZIndex("overlay")}
          onConfirm={() => deleting && deletion.mutate(deleting.id, { onSuccess: closeDelete })}
          onClose={closeDelete}
        >
          {`Delete ${deleting?.name}?`}
        </ConfirmDialog>
      </>
    ),
  };
}

function PromptCardForm({
  kind,
  card,
  onClose,
}: {
  kind: PromptCardKind;
  card?: PromptCard;
  onClose: () => void;
}) {
  const { hint, placeholder } = promptCardText[kind];
  const [name, setName] = useState(card?.name || "");
  const [description, setDescription] = useState(card?.description || "");
  const [images, setImages] = useState<ReferenceAsset[]>(card?.references || []);
  const save = useSavePromptCard(kind, card?.id);
  return (
    <CardForm
      onSubmit={() =>
        save.mutate(
          {
            name: name.trim(),
            description: description.trim(),
            referenceIds: images.map((asset) => asset.id),
          },
          { onSuccess: onClose },
        )
      }
    >
      <CardFields
        kind={kind}
        name={name}
        onName={setName}
        description={description}
        onDescription={setDescription}
        hint={hint}
        placeholder={placeholder}
        max={cardKinds[kind].images.max}
        note="Optional, to recognise it by."
        images={images}
        onImages={setImages}
      />
      {save.error && <Alert color="red">{save.error.message}</Alert>}
      <DialogFooter pending={save.isPending} onCancel={onClose}>
        <Button
          type="submit"
          loading={save.isPending}
          disabled={!name.trim() || !description.trim()}
        >
          Save
        </Button>
      </DialogFooter>
    </CardForm>
  );
}

/** An outfit's or scene's ⋯ menu: Edit, then Delete. */
export function PromptCardMenu({
  kind,
  card,
  onEdit,
  onDelete,
  onUse,
  withinPortal = true,
}: {
  kind: PromptCardKind;
  card: PromptCard;
  onEdit: () => void;
  onDelete: () => void;
  /** Library's Use in Composer; the References sheet picks a card by its tile instead. */
  onUse?: () => void;
  /** Off inside a popover, so choosing an item is not a press outside it. */
  withinPortal?: boolean;
}) {
  const { noun } = promptCardText[kind];
  return (
    <Menu position="bottom-end" width={menuWidth} withinPortal={withinPortal}>
      <Menu.Target>
        <ActionIcon variant="default" aria-label={`Actions for ${card.name}`}>
          <icons.more size={14} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <ActionMenuItems
          groups={[
            [
              ...(onUse
                ? [{ id: "use", label: "Use in Composer", icon: icons.prompt, onClick: onUse }]
                : []),
              { id: "edit", label: `Edit ${noun}`, icon: icons.edit, onClick: onEdit },
            ],
            [
              {
                id: "delete",
                label: `Delete ${noun}`,
                icon: icons.delete,
                color: "red",
                onClick: onDelete,
              },
            ],
          ]}
        />
      </Menu.Dropdown>
    </Menu>
  );
}
