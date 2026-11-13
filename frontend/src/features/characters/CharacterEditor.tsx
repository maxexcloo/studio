import { useState } from "react";
import { Alert, Button, Group, Input, Loader, Stack, Text } from "@mantine/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { post } from "../../api";
import type { MediaItem, ReferenceAsset } from "../../types";
import { DialogFooter } from "../../ui/ConfirmDialog";
import { icons } from "../../ui/icons";
import { EmptyState } from "../../ui/EmptyState";
import { maxCharacterImages } from "../../../../shared/characters";
import { chipProps } from "../generation/chip";
import { PickerGrid, PickerTile } from "../generation/Picker";
import { statusLabels } from "../generation/Queue";
import { CardDialog, CardFields, CardForm, CardThumbnails } from "./CardImages";
import { charactersQuery, useMakeSheet, useSaveCharacter, type CharacterCard } from "./queries";

/** What a new card starts from, such as Use as Character's image. */
export interface CharacterStart {
  references: ReferenceAsset[];
}

/**
 * New Character and Edit Character: a name, a short description and 1–4 images, chosen from the
 * gallery or uploaded, in the order they fill reference slots. A saved card also generates
 * references to pick from and makes its sheet.
 */
export function CharacterEditor({
  opened,
  character,
  start,
  onClose,
  onGenerate,
  generating = false,
}: {
  opened: boolean;
  character?: CharacterCard;
  start?: CharacterStart;
  onClose: () => void;
  /** Generate References for a saved card. */
  onGenerate?: (card: CharacterCard) => void;
  generating?: boolean;
}) {
  return (
    <CardDialog
      opened={opened}
      onClose={onClose}
      title={character ? "Edit Character" : "New Character"}
    >
      {opened && (
        <CharacterForm
          key={character?.id || "new"}
          character={character}
          start={start}
          onClose={onClose}
          onGenerate={onGenerate}
          generating={generating}
        />
      )}
    </CardDialog>
  );
}

function CharacterForm({
  character,
  start,
  onClose,
  onGenerate,
  generating,
}: {
  character?: CharacterCard;
  start?: CharacterStart;
  onClose: () => void;
  onGenerate?: (card: CharacterCard) => void;
  generating?: boolean;
}) {
  const [name, setName] = useState(character?.name || "");
  const [description, setDescription] = useState(character?.description || "");
  const [images, setImages] = useState<ReferenceAsset[]>(
    character?.references || start?.references || [],
  );
  const save = useSaveCharacter(character?.id);
  const full = images.length >= maxCharacterImages;
  // The card as it stands now, for Generate References' results as they finish.
  const characters = useQuery({ ...charactersQuery, enabled: Boolean(character) });
  const current = characters.data?.find((card) => card.id === character?.id) || character;
  const making = useMakeSheet();
  const sheet = current?.sheet;
  // Each queued job's results, or a placeholder until its first appears in the gallery.
  const generated = (current?.generated?.jobIds || []).flatMap((jobId) => {
    const results = current!.generated!.results.filter((result) => result.jobId === jobId);
    return results.length
      ? results
      : [{ galleryItemId: jobId, jobId, status: "queued", thumbnailUrl: "", prompt: "" }];
  });
  const fromGallery = useMutation({
    mutationFn: async (item: Pick<MediaItem, "id">) =>
      (
        await post<{ asset: ReferenceAsset }>("/api/reference-assets/from-gallery", {
          galleryItemId: item.id,
        })
      ).asset,
    onSuccess: (asset) => setImages((previous) => [...previous, asset]),
  });
  const error = save.error || fromGallery.error;
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
        kind="characters"
        name={name}
        onName={setName}
        description={description}
        onDescription={setDescription}
        hint="Lasting looks such as age, build, hair and skin, not clothing."
        placeholder="Red-haired ranger, green cloak, scar over left eye"
        max={maxCharacterImages}
        note="The first leads when the character is picked, so make it the clearest view."
        images={images}
        onImages={setImages}
      />
      {current && onGenerate && (
        <Input.Wrapper
          component="section"
          aria-label="Generated References"
          label="Generated References"
          labelElement="div"
          description={
            generated.length
              ? "Pick the ones to keep. The rest stay in the gallery."
              : "A portrait and front, side and back views from the description and first image."
          }
        >
          <Stack gap="xs" mt={6}>
            {generated.length ? (
              <PickerGrid label="Generated References">
                {generated.map((result, index) => {
                  const selected = images.some(
                    (asset) => asset.galleryItemId === result.galleryItemId,
                  );
                  const done = result.status === "done";
                  return (
                    <PickerTile
                      key={result.galleryItemId}
                      label={`${selected ? "Remove" : "Add"} generated reference ${index + 1}`}
                      selected={selected}
                      disabled={!done || full || fromGallery.isPending}
                      image={done ? result.thumbnailUrl : undefined}
                      placeholder={done ? undefined : icons.variations}
                      title={done ? "Ready" : resultStatus(result.status)}
                      onToggle={() =>
                        selected
                          ? setImages(
                              images.filter(
                                (asset) => asset.galleryItemId !== result.galleryItemId,
                              ),
                            )
                          : fromGallery.mutate({ id: result.galleryItemId })
                      }
                    />
                  );
                })}
              </PickerGrid>
            ) : (
              <EmptyState fill>None Yet</EmptyState>
            )}
            <Group gap="xs">
              <Button
                {...chipProps}
                leftSection={<icons.variations size={15} />}
                loading={generating}
                onClick={() => onGenerate(current)}
              >
                Generate References
              </Button>
            </Group>
          </Stack>
        </Input.Wrapper>
      )}
      {current && (
        <Input.Wrapper
          component="section"
          aria-label="Sheet"
          label="Sheet"
          labelElement="div"
          description="Front, side and back views, expressions and gear, sent when a prompt names a view."
        >
          <Stack gap="xs" mt={6}>
            {sheet?.status === "making" ? (
              <Group gap="xs" role="status">
                <Loader size={14} />
                <Text size="sm" c="dimmed">
                  Making Sheet…
                </Text>
              </Group>
            ) : sheet?.status === "failed" ? (
              <Text size="sm" c="red">
                {`Sheet Failed${sheet.error ? `: ${sheet.error}` : ""}`}
              </Text>
            ) : sheetViews(current).length ? (
              <CardThumbnails
                label={`${current.name}'s Sheet`}
                images={sheetViews(current)}
                views
              />
            ) : (
              <EmptyState fill>No Sheet Yet</EmptyState>
            )}
            <Group gap="xs">
              <Button
                {...chipProps}
                leftSection={<icons.sheet size={15} />}
                loading={making.isPending}
                disabled={!current.references.length || sheet?.status === "making"}
                onClick={() => making.mutate(current)}
              >
                {sheet ? "Make Sheet Again" : "Make Sheet"}
              </Button>
            </Group>
          </Stack>
        </Input.Wrapper>
      )}
      {error && <Alert color="red">{error.message}</Alert>}
      <DialogFooter pending={save.isPending} onCancel={onClose}>
        <Button type="submit" loading={save.isPending} disabled={!name.trim() || !images.length}>
          Save
        </Button>
      </DialogFooter>
    </CardForm>
  );
}

/** A generated reference's state while it has no picture, in the queue's words. */
const resultStatus = (status: string) =>
  statusLabels[status as keyof typeof statusLabels] ?? "Generating";

/** A card's sheet views (Face, Front, Side, Back and Gear) to show, without the whole sheet. */
export const sheetViews = (card: CharacterCard) =>
  (card.sheet?.panels || [])
    .filter((panel) => panel.role !== "sheet")
    .map((panel) => ({
      key: panel.id,
      src: panel.url || panel.thumbnailUrl,
      thumbnailUrl: panel.thumbnailUrl,
      alt: `${card.name} ${panel.role[0].toUpperCase()}${panel.role.slice(1)}`,
    }));
