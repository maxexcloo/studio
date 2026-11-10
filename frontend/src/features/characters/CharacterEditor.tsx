import { useState } from "react";
import {
  ActionIcon,
  Alert,
  Button,
  FileButton,
  FocusTrap,
  getDefaultZIndex,
  Group,
  Image,
  Modal,
  ScrollArea,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post } from "../../api";
import type { MediaItem, ReferenceAsset } from "../../types";
import { DialogFooter } from "../../ui/ConfirmDialog";
import { EmptyState } from "../../ui/EmptyState";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import { SearchInput } from "../../ui/SearchInput";
import { TextBox } from "../../ui/TextBox";
import { usePhone } from "../../ui/usePhone";
import {
  maxCharacterDescription,
  maxCharacterImages,
  maxCharacterName,
} from "../../../../shared/characters";
import { emptyGalleryFilters } from "../gallery/GalleryFilters";
import { PickerGrid, PickerTile } from "../generation/Picker";
import { assistantQuery } from "../generation/PromptAssistant";
import { uploadTypes, useGalleryImages } from "../generation/references";
import { charactersQuery, useSaveCharacter, type CharacterCard } from "./queries";

/** What a new card starts from, such as Make Character's image. */
export interface CharacterStart {
  references: ReferenceAsset[];
}

/**
 * New Character and Edit Character: a name, a short description and 1–4 images, chosen from the
 * gallery or uploaded, in the order they fill reference slots. Opens above a References sheet.
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
  const phone = usePhone();
  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={character ? "Edit Character" : "New Character"}
      fullScreen={phone}
      // Above the desktop References popover; phones stack sheets in order, under the text editor.
      zIndex={phone ? undefined : getDefaultZIndex("overlay")}
    >
      <FocusTrap.InitialFocus />
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
    </Modal>
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
  const [query, setQuery] = useState("");
  const phone = usePhone();
  const client = useQueryClient();
  const save = useSaveCharacter(character?.id);
  const { listing, items } = useGalleryImages(query, emptyGalleryFilters, true);
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
  const upload = useMutation({
    mutationKey: ["reference-upload"],
    mutationFn: async (files: File[]) => {
      for (const file of files.filter((file) => uploadTypes.includes(file.type))) {
        const form = new FormData();
        form.append("image", file);
        const { asset } = await api<{ asset: ReferenceAsset }>("/api/reference-assets/upload", {
          method: "POST",
          body: form,
        });
        setImages((previous) =>
          previous.length < maxCharacterImages ? [...previous, asset] : previous,
        );
      }
    },
    // An upload is a gallery image, listed under the Uploads filter.
    onSettled: () => client.invalidateQueries({ queryKey: ["gallery"] }),
  });
  // With a prompt assistant that reads images, the first image can be written up as the description.
  const assistant = useQuery(assistantQuery);
  const describe = useMutation({
    mutationFn: (asset: ReferenceAsset) =>
      post<{ description: string }>("/api/assistant/character", { assetId: asset.id }),
    onSuccess: ({ description }) => setDescription(description),
  });
  const describable = assistant.data?.available && assistant.data.vision && images[0];
  const error = save.error || fromGallery.error || upload.error || describe.error;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate(
          {
            name: name.trim(),
            description: description.trim(),
            referenceIds: images.map((asset) => asset.id),
          },
          {
            onSuccess: onClose,
          },
        );
      }}
    >
      <Stack>
        <TextInput
          label="Name"
          placeholder="Mara"
          required
          maxLength={maxCharacterName}
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
          maxLength={maxCharacterDescription}
          value={description}
          onChange={setDescription}
          below={
            describable && (
              <Group>
                <Button
                  variant="subtle"
                  size="compact-sm"
                  leftSection={<icons.assistant size={15} />}
                  loading={describe.isPending}
                  onClick={() => describe.mutate(images[0])}
                >
                  Describe Image
                </Button>
              </Group>
            )
          }
        />
        <Stack gap={6}>
          <Text size="sm" fw={500}>
            Images
          </Text>
          <Text size="xs" c="dimmed">
            {`1 to ${maxCharacterImages}. Picking the character gives a model the first, so make it the clearest view: a model draws one person in several images twice.`}
          </Text>
          <SimpleGrid
            cols={maxCharacterImages}
            spacing="xs"
            role="list"
            aria-label="Character Images"
          >
            {images.map((asset, index) => (
              <div key={asset.id} role="listitem" style={{ position: "relative" }}>
                <Image
                  src={asset.thumbnailUrl || asset.url}
                  alt={`Image ${index + 1}`}
                  radius="md"
                  style={{ aspectRatio: "1", objectFit: "cover" }}
                  fallbackSrc=""
                />
                <ActionIcon
                  variant="default"
                  size="sm"
                  aria-label={`Remove Image ${index + 1}`}
                  style={{ position: "absolute", top: 4, right: 4 }}
                  onClick={() => setImages(images.filter((other) => other !== asset))}
                >
                  <icons.clear size={14} />
                </ActionIcon>
              </div>
            ))}
          </SimpleGrid>
        </Stack>
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
        <Group gap="xs" wrap="nowrap">
          <SearchInput
            style={{ flex: 1 }}
            aria-label="Search Gallery"
            size="sm"
            radius="xl"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onClear={() => setQuery("")}
          />
          <FileButton
            accept={uploadTypes.join(",")}
            multiple
            onChange={(files) => upload.mutate(files)}
          >
            {(props) => (
              <Button
                {...props}
                variant="default"
                size="sm"
                aria-label="Upload Image"
                loading={upload.isPending}
                disabled={full}
                leftSection={<icons.upload size={15} />}
              >
                Upload
              </Button>
            )}
          </FileButton>
        </Group>
        {listing.isPending ? (
          <LoadingState label="Loading Images" />
        ) : !items.length ? (
          <EmptyState fill>{query ? "No Matches" : "No Images"}</EmptyState>
        ) : (
          <ScrollArea.Autosize mah={phone ? "40dvh" : 260}>
            <PickerGrid label="Image Choices">
              {items.map((item) => {
                const selected = images.some((asset) => asset.galleryItemId === item.id);
                return (
                  <PickerTile
                    key={item.id}
                    label={`${selected ? "Remove" : "Add"} image: ${item.prompt || "Upload"}`}
                    selected={selected}
                    disabled={full || fromGallery.isPending}
                    image={item.thumbnailUrl || item.url}
                    onToggle={() =>
                      selected
                        ? setImages(images.filter((asset) => asset.galleryItemId !== item.id))
                        : fromGallery.mutate(item)
                    }
                  />
                );
              })}
            </PickerGrid>
            {listing.hasNextPage && (
              <Button
                variant="subtle"
                loading={listing.isFetchingNextPage}
                onClick={() => void listing.fetchNextPage()}
              >
                Load More
              </Button>
            )}
          </ScrollArea.Autosize>
        )}
        {error && <Alert color="red">{error.message}</Alert>}
        <DialogFooter pending={save.isPending} onCancel={onClose}>
          <Button type="submit" loading={save.isPending} disabled={!name.trim() || !images.length}>
            Save
          </Button>
        </DialogFooter>
      </Stack>
    </form>
  );
}
