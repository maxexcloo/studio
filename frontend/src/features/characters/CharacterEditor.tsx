import {
  Alert,
  Button,
  Group,
  Input,
  Loader,
  NumberInput,
  Paper,
  Stack,
  TagsInput,
  Text,
  TextInput,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

import {
  type CharacterTrait,
  maxCharacterAge,
  maxCharacterImages,
  maxCharacterTrait,
  minCharacterAge,
  sheetRoles,
} from "../../../../shared/characters";
import type { ReferenceAsset } from "../../types";
import { DialogFooter } from "../../ui/ConfirmDialog";
import { EmptyState } from "../../ui/EmptyState";
import { icons } from "../../ui/icons";
import { TextBox } from "../../ui/TextBox";
import { titleCase } from "../../ui/titleCase";
import { chipProps } from "../generation/chip";
import { CardDialog, CardFields, CardForm, CardThumbnails } from "./CardImages";
import { type CharacterCard, charactersQuery, useMakeSheet, useSaveCharacter } from "./queries";

/** What a new card starts from, such as Use as Character's image and what its chat called it. */
export interface CharacterStart {
  references: ReferenceAsset[];
  name?: string;
  description?: string;
}

type Story = Partial<Record<CharacterTrait, string>> & { age?: number };

/**
 * New Character and Edit Character: a name, a short description and 1–4 images, chosen from the
 * gallery or uploaded, the first leading. A saved card also makes its sheet.
 */
export function CharacterEditor({
  opened,
  character,
  start,
  onClose,
}: {
  opened: boolean;
  character?: CharacterCard;
  start?: CharacterStart;
  onClose: () => void;
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
        />
      )}
    </CardDialog>
  );
}

function CharacterForm({
  character,
  start,
  onClose,
}: {
  character?: CharacterCard;
  start?: CharacterStart;
  onClose: () => void;
}) {
  const [name, setName] = useState(character?.name || start?.name || "");
  const [description, setDescription] = useState(
    character?.description || start?.description || "",
  );
  const [story, setStory] = useState<Story>({
    age: character?.age,
    job: character?.job,
    backstory: character?.backstory,
    likes: character?.likes,
    dislikes: character?.dislikes,
  });
  const [images, setImages] = useState<ReferenceAsset[]>(
    character?.references || start?.references || [],
  );
  const save = useSaveCharacter(character?.id);
  // The card as it stands now, for its sheet as it is made.
  const characters = useQuery({ ...charactersQuery, enabled: Boolean(character) });
  const current = characters.data?.find((card) => card.id === character?.id) || character;
  const making = useMakeSheet();
  const sheet = current?.sheet;
  const error = save.error;
  return (
    <CardForm
      onSubmit={() =>
        save.mutate(
          {
            name: name.trim(),
            description: description.trim(),
            ...story,
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
      <CharacterStory story={story} onStory={setStory} />
      {current && (
        <EditorSection
          label="Sheet"
          description="Face, front, side and back views, each sent in place of the first image when a prompt names that view."
          empty="No Sheet Yet"
          action={
            <Button
              {...chipProps}
              leftSection={<icons.sheet size={15} />}
              loading={making.isPending}
              disabled={!current.references.length || sheet?.status === "making"}
              onClick={() => making.mutate(current)}
            >
              {sheet ? "Make Sheet Again" : "Make Sheet"}
            </Button>
          }
        >
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
          ) : (
            sheetViews(current).length > 0 && (
              <CardThumbnails
                label={`${current.name}'s Sheet`}
                images={sheetViews(current)}
                views
              />
            )
          )}
        </EditorSection>
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

// The panels a card shows as its views; any other a sheet holds stays off it.
const viewRoles: string[] = sheetRoles.filter((role) => role !== "sheet");

/** A card's sheet views (Face, Front, Side and Back) to show, without the whole sheet. */
export const sheetViews = (card: CharacterCard) =>
  (card.sheet?.panels || [])
    .filter((panel) => viewRoles.includes(panel.role))
    .map((panel) => ({
      key: panel.id,
      src: panel.url || panel.thumbnailUrl,
      thumbnailUrl: panel.thumbnailUrl,
      alt: `${card.name} ${titleCase(panel.role)}`,
    }));

/** A part of the editor under its label: its content then its action, or, empty, both framed. */
function EditorSection({
  label,
  description,
  empty,
  action,
  children,
}: {
  label: string;
  description: string;
  empty: string;
  action: ReactNode;
  children: ReactNode;
}) {
  return (
    <Input.Wrapper
      size="md"
      component="section"
      aria-label={label}
      label={label}
      labelElement="div"
      description={description}
    >
      {children ? (
        <Stack gap="xs" mt={6} align="flex-start">
          {children}
          {action}
        </Stack>
      ) : (
        <Paper withBorder radius="md" py="md" mt={6}>
          <EmptyState fill action={action}>
            {empty}
          </EmptyState>
        </Paper>
      )}
    </Input.Wrapper>
  );
}

/** A character's age and story: shown on its card, never sent to a model. */
function CharacterStory({ story, onStory }: { story: Story; onStory: (story: Story) => void }) {
  const text = (key: CharacterTrait) => ({
    maxLength: maxCharacterTrait,
    value: story[key] || "",
    onChange: (value: string) => onStory({ ...story, [key]: value }),
  });
  return (
    <>
      <Group grow align="flex-start">
        <NumberInput
          label="Age"
          min={minCharacterAge}
          max={maxCharacterAge}
          allowDecimal={false}
          value={story.age ?? ""}
          onChange={(value) =>
            onStory({ ...story, age: typeof value === "number" ? value : undefined })
          }
        />
        <TextInput
          label="Job"
          {...text("job")}
          onChange={(event) => text("job").onChange(event.currentTarget.value)}
        />
      </Group>
      <TextBox label="Backstory" autosize minRows={2} {...text("backstory")} />
      <Group grow align="flex-start">
        {(["likes", "dislikes"] as const).map((key) => {
          const value = story[key] || "";
          const error =
            value.length > maxCharacterTrait
              ? `Keep the ${key} within ${maxCharacterTrait} characters.`
              : "";
          return (
            <TagsInput
              key={key}
              label={key === "likes" ? "Likes" : "Dislikes"}
              maxLength={Math.max(0, maxCharacterTrait - value.length - Number(Boolean(value)))}
              error={error}
              ref={(input) => input?.setCustomValidity(error)}
              // Keep comma-containing phrases intact in the stored newline-separated text.
              splitChars={[]}
              value={value ? value.split("\n") : []}
              onChange={(values) => onStory({ ...story, [key]: values.join("\n") })}
              comboboxProps={{ withinPortal: false }}
            />
          );
        })}
      </Group>
    </>
  );
}
