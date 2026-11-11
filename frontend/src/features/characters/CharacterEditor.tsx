import { useState } from "react";
import { Alert, Button, Group, Stack, Text, TextInput } from "@mantine/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { post } from "../../api";
import type { MediaItem, ReferenceAsset } from "../../types";
import { DialogFooter } from "../../ui/ConfirmDialog";
import { icons } from "../../ui/icons";
import { TextBox } from "../../ui/TextBox";
import { maxCardDescription, maxCharacterImages, maxCardName } from "../../../../shared/characters";
import { PickerGrid, PickerTile } from "../generation/Picker";
import { CardDialog, CardForm, CardImages, DescribeImage } from "./CardImages";
import { charactersQuery, useSaveCharacter, type CharacterCard } from "./queries";

/** What a new card starts from, such as Use as Character's image. */
export interface CharacterStart {
  references: ReferenceAsset[];
}

/**
 * New Character and Edit Character: a name, a short description and 1–4 images, chosen from the
 * gallery or uploaded, in the order they fill reference slots.
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
      <TextInput
        label="Name"
        placeholder="Mara"
        required
        maxLength={maxCardName}
        data-autofocus
        value={name}
        onChange={(event) => setName(event.currentTarget.value)}
      />
      <TextBox
        label="Description"
        description="Lasting looks such as age, build, hair and skin, not clothing. Leads the prompt when the character is picked."
        placeholder="Red-haired ranger, green cloak, scar over left eye"
        autosize
        minRows={2}
        maxLength={maxCardDescription}
        value={description}
        onChange={setDescription}
        below={<DescribeImage kind="characters" image={images[0]} onDescribed={setDescription} />}
      />
      <CardImages
        kind="characters"
        max={maxCharacterImages}
        note={`1 to ${maxCharacterImages}. Picking the character gives a model the first, so make it the clearest view: a model draws one person in several images twice.`}
        value={images}
        onChange={setImages}
      >
        {current && onGenerate && (
          <Stack gap={6}>
            <Group justify="space-between" wrap="nowrap">
              <Text size="sm" fw={500}>
                Generated References
              </Text>
              <Button
                variant="subtle"
                size="compact-sm"
                leftSection={<icons.variations size={15} />}
                loading={generating}
                onClick={() => onGenerate(current)}
              >
                Generate References
              </Button>
            </Group>
            <Text size="xs" c="dimmed">
              {generated.length
                ? "Pick the ones to keep. Saving ends the wait for the rest, which stay in the gallery."
                : "A front portrait and full-body front, side and back views on a plain background, from the description, and from the first image where a model that edits with references is ready."}
            </Text>
            {generated.length > 0 && (
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
            )}
          </Stack>
        )}
      </CardImages>
      {error && <Alert color="red">{error.message}</Alert>}
      <DialogFooter pending={save.isPending} onCancel={onClose}>
        <Button type="submit" loading={save.isPending} disabled={!name.trim() || !images.length}>
          Save
        </Button>
      </DialogFooter>
    </CardForm>
  );
}
