import { useState } from "react";
import { Button, Group, Menu, SegmentedControl, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { Bookmark, Check, ChevronDown } from "lucide-react";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api";
import type { GenerationInput, Profile, ReferenceAsset } from "../../types";
import { LoadingState } from "../../ui/LoadingState";
import { usePhone } from "../../ui/usePhone";
import { useRemembered } from "../auth/useRemembered";
import { inspirationInput, inspirationQuery } from "./inspiration";
import { iconChipProps } from "./chip";
import { generationInput } from "./payload";
import {
  ChipPopup,
  PickerHeader,
  SaveCurrent,
  SavedList,
  SortMenu,
  savedSortLabels,
  savedItems,
  type SavedSort,
} from "./Picker";
import classes from "./Picker.module.css";
export interface Preset {
  id: string;
  title: string;
  input: GenerationInput;
  savedAt?: string;
  /** The parts of the draft it holds, when only some; one saved without holds them all. */
  parts?: PresetPart[];
}
/** The parts of a draft a preset may hold, by their input fields; Model & Settings has the rest. */
const presetParts = [
  { value: "prompt", label: "Prompt", noun: "prompt", keys: ["prompt"] },
  { value: "negative", label: "Negative", noun: "negative prompt", keys: ["negative"] },
  { value: "settings", label: "Model & Settings", noun: "model and settings", keys: [] },
  {
    value: "size",
    label: "Size",
    noun: "size",
    keys: ["width", "height", "resolution", "resolutionTier", "tiledDecode"],
  },
  { value: "loras", label: "LoRAs", noun: "LoRAs", keys: ["loras"] },
  {
    value: "references",
    label: "References",
    noun: "references",
    keys: ["referenceAssets", "referenceDetails"],
  },
] as const;
type PresetPart = (typeof presetParts)[number]["value"];
const partOf = (key: string): PresetPart =>
  presetParts.find((part) => (part.keys as readonly string[]).includes(key))?.value ?? "settings";
/** The input's fields in `parts`, or all of it. */
const presetInput = (input: GenerationInput, parts?: PresetPart[]) =>
  (parts
    ? Object.fromEntries(Object.entries(input).filter(([key]) => parts.includes(partOf(key))))
    : input) as GenerationInput;
/** Asks before a preset replaces the draft's parts it holds. */
function replaceMessage(preset: Preset) {
  if (!preset.parts) return "Replace the current prompt and settings with this preset?";
  const nouns = presetParts
    .filter((part) => preset.parts?.includes(part.value))
    .map((part) => part.noun);
  const list = nouns.length > 1 ? `${nouns.slice(0, -1).join(", ")} and ${nouns.at(-1)}` : nouns[0];
  return `Replace the current ${list} with this preset? The rest stays as it is.`;
}
/** The preset an editor last loaded or saved. */
export interface PresetSelection {
  presetId?: string;
  presetTitle?: string;
}
/** The account's saved presets, newest first. */
const presetsQuery = queryOptions({
  queryKey: ["user-presets"],
  queryFn: () => api<{ presets: Preset[] }>("/api/user-presets"),
});
const json = (method: string, value: unknown) => ({ method, body: JSON.stringify(value) });
const defaultParts: PresetPart[] = ["prompt", "negative", "settings", "size", "loras"];

/**
 * The Presets chip and its popup for any generation editor, built on the same picker as LoRA
 * stacks: search, sort, load (asking before replacing a written prompt), rename, update and
 * delete, with Clear and Save Preset in its heading. Administrators also choose Inspiration, the
 * Library's imported images, which load their settings where the editor's profile fits them and
 * otherwise their prompt; they are edited in Library › Imports. `onLoad` replaces that editor's
 * input and preset selection, then the popup closes.
 */
export function PresetPicker({
  input,
  references,
  profile,
  selection,
  onSelectionChange,
  onLoad,
}: {
  input: GenerationInput;
  references: ReferenceAsset[];
  profile?: Profile;
  selection: PresetSelection;
  onSelectionChange: (selection: PresetSelection) => void;
  onLoad: (input: GenerationInput, selection: PresetSelection) => void;
}) {
  const [opened, setOpened] = useState(false);
  const phone = usePhone();
  const client = useQueryClient();
  const [source, setSource] = useState<"saved" | "inspiration">("saved");
  const inspiring = source === "inspiration";
  const presets = useQuery({ ...presetsQuery, enabled: opened && !inspiring });
  const inspiration = useQuery({ ...inspirationQuery, enabled: opened && inspiring });
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SavedSort>("name-asc");
  const [parts, setParts] = useRemembered("preset-parts", defaultParts);
  // A preset of every part holds them all, as one saved before parts.
  const savedParts = parts.length < presetParts.length ? parts : undefined;
  const refresh = () => void client.invalidateQueries({ queryKey: presetsQuery.queryKey });
  const current = () => generationInput(input, profile, references);
  const change = useMutation({
    mutationFn: ({
      id,
      method,
      value,
    }: {
      id?: string;
      method: "POST" | "PATCH" | "DELETE";
      value?: Partial<Preset>;
      deleted?: Preset;
    }) =>
      api<{ preset?: Preset }>(
        id ? `/api/user-presets/${encodeURIComponent(id)}` : "/api/user-presets",
        json(method, value ?? {}),
      ),
    onSuccess: ({ preset }, { method, deleted }) => {
      refresh();
      if (method === "POST" && preset)
        onSelectionChange({ presetId: preset.id, presetTitle: preset.title });
      if (deleted) {
        if (deleted.id === selection.presetId)
          onSelectionChange({ presetId: undefined, presetTitle: undefined });
        notifications.show({
          message: (
            <Group justify="space-between">
              <Text size="sm">Preset deleted</Text>
              <Button
                variant="subtle"
                onClick={() =>
                  change.mutate({
                    method: "POST",
                    value: { title: deleted.title, input: deleted.input, parts: deleted.parts },
                  })
                }
              >
                Undo
              </Button>
            </Group>
          ),
        });
      }
    },
  });
  // The list arrives newest first; saved items sort undated records by their place, oldest first.
  const items = [...(presets.data?.presets || [])]
    .reverse()
    .map((preset) => ({ ...preset, name: preset.title }));
  const ideas = (inspiration.data?.presets || []).map((preset) => ({
    ...preset,
    detail: preset.prompt,
  }));
  const error = (inspiring ? inspiration : presets).error;
  return (
    <ChipPopup
      title="Presets"
      tooltip
      position="top-end"
      width={360}
      opened={opened}
      onOpenedChange={setOpened}
      target={
        <Button
          {...iconChipProps}
          aria-label="Presets"
          aria-expanded={opened}
          onClick={() => setOpened(!opened)}
        >
          <Bookmark size={16} />
        </Button>
      }
      headerEnd={
        <SaveCurrent
          noun="Preset"
          disabled={!input.prompt.trim()}
          onSave={(title) =>
            change.mutate({
              method: "POST",
              value: { title, input: presetInput(current(), savedParts), parts: savedParts },
            })
          }
          options={
            <Menu withinPortal={false} position="bottom-end" closeOnItemClick={false}>
              <Menu.Target>
                <Button
                  size="compact-sm"
                  variant="subtle"
                  color="gray"
                  aria-label="Preset Parts"
                  rightSection={<ChevronDown size={14} />}
                >
                  Parts
                </Button>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Label>Save</Menu.Label>
                {presetParts.map(({ value, label }) => {
                  const checked = parts.includes(value);
                  return (
                    <Menu.Item
                      key={value}
                      aria-checked={checked}
                      // A preset holds at least one part.
                      disabled={checked && parts.length === 1}
                      rightSection={checked && <Check size={14} />}
                      onClick={() =>
                        setParts(
                          checked
                            ? parts.filter((part) => part !== value)
                            : presetParts
                                .map((part) => part.value)
                                .filter((part) => part === value || parts.includes(part)),
                        )
                      }
                    >
                      {label}
                    </Menu.Item>
                  );
                })}
              </Menu.Dropdown>
            </Menu>
          }
        >
          <Button
            size="compact-sm"
            variant="subtle"
            aria-label="Clear Preset"
            disabled={!selection.presetId}
            onClick={() => onSelectionChange({ presetId: undefined, presetTitle: undefined })}
          >
            Clear
          </Button>
        </SaveCurrent>
      }
    >
      <Stack gap="sm" flex={1} mih={0}>
        <SegmentedControl
          aria-label="Preset Source"
          size="xs"
          fullWidth
          data={[
            { value: "saved", label: "Saved" },
            { value: "inspiration", label: "Inspiration" },
          ]}
          value={source}
          onChange={(value) => setSource(value as typeof source)}
        />
        <PickerHeader
          label="Presets"
          query={query}
          onQueryChange={setQuery}
          actions={<SortMenu labels={savedSortLabels} value={sort} onChange={setSort} />}
        />
        {error && (
          <Text c="red" size="sm">
            {error.message}
          </Text>
        )}
        {/* Desktop keeps the list at one height, so switching source or loading never resizes the
            popup; the phone sheet's body scrolls it, between its header and footer. */}
        <Stack
          gap={0}
          h={phone ? undefined : "min(45dvh, 360px)"}
          flex={phone ? 1 : undefined}
          mih={0}
          className={classes.list}
        >
          {(inspiring ? inspiration : presets).isPending ? (
            <LoadingState fill label={inspiring ? "Loading Inspiration" : "Loading Presets"} />
          ) : inspiring ? (
            <SavedList
              label="Inspiration"
              noun="Inspiration"
              items={savedItems(ideas, query, sort)}
              empty={ideas.length ? "No Matches" : "No Inspiration"}
              replaces={!!input.prompt.trim()}
              replaceMessage="Replace the current prompt with this inspiration, and its settings where they fit?"
              onLoad={(preset) => {
                onLoad(inspirationInput(preset, input, profile), {});
                setOpened(false);
              }}
            />
          ) : (
            <SavedList
              label="Saved Presets"
              noun="Preset"
              items={savedItems(items, query, sort)}
              current={selection.presetId}
              empty={items.length ? "No Matches" : "No Saved Presets"}
              replaces={!!input.prompt.trim()}
              replaceMessage={replaceMessage}
              onLoad={(preset) => {
                // A preset of some parts leaves the rest of the draft as it is.
                onLoad(preset.parts ? { ...current(), ...preset.input } : preset.input, {
                  presetId: preset.id,
                  presetTitle: preset.title,
                });
                setOpened(false);
              }}
              onRename={(preset, title) => {
                change.mutate({ id: preset.id, method: "PATCH", value: { title } });
                if (preset.id === selection.presetId)
                  onSelectionChange({ presetId: preset.id, presetTitle: title });
              }}
              onUpdate={(preset) =>
                change.mutate({
                  id: preset.id,
                  method: "PATCH",
                  value: { input: presetInput(current(), preset.parts) },
                })
              }
              onDelete={(preset) =>
                change.mutate({ id: preset.id, method: "DELETE", deleted: preset })
              }
            />
          )}
        </Stack>
      </Stack>
    </ChipPopup>
  );
}
