import { useState } from "react";
import { Button, Group, ScrollArea, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { Bookmark } from "lucide-react";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api";
import type { GenerationInput, Profile, ReferenceAsset } from "../../types";
import { usePhone } from "../../ui/usePhone";
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
export interface Preset {
  id: string;
  title: string;
  input: GenerationInput;
  savedAt?: string;
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

/**
 * The Presets chip and its popup for any generation editor, built on the same picker as LoRA
 * stacks: search, sort, load (asking before replacing a written prompt), rename, update and
 * delete, with Clear and Save Preset in its heading. `onLoad` replaces that editor's draft,
 * then the popup closes.
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
  onLoad: (preset: Preset) => void;
}) {
  const [opened, setOpened] = useState(false);
  const phone = usePhone();
  const client = useQueryClient();
  const presets = useQuery({ ...presetsQuery, enabled: opened });
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SavedSort>("name-asc");
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
                    value: { title: deleted.title, input: deleted.input },
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
        <>
          <Button
            size="compact-sm"
            variant="subtle"
            aria-label="Clear Preset"
            disabled={!selection.presetId}
            onClick={() => onSelectionChange({ presetId: undefined, presetTitle: undefined })}
          >
            Clear
          </Button>
          <SaveCurrent
            noun="Preset"
            compact
            disabled={!input.prompt.trim()}
            onSave={(title) =>
              change.mutate({
                method: "POST",
                value: { title, input: current() },
              })
            }
          />
        </>
      }
    >
      <Stack gap="sm" flex={1} mih={0}>
        <PickerHeader
          label="Presets"
          query={query}
          onQueryChange={setQuery}
          actions={<SortMenu labels={savedSortLabels} value={sort} onChange={setSort} />}
        />
        {presets.error && (
          <Text c="red" size="sm">
            {presets.error.message}
          </Text>
        )}
        {/* The phone sheet's body scrolls the list, between its header and footer. */}
        <ScrollArea.Autosize mah={phone ? undefined : "min(45dvh, 360px)"}>
          <SavedList
            label="Saved Presets"
            noun="Preset"
            items={savedItems(items, query, sort)}
            current={selection.presetId}
            empty={items.length ? "No Matches" : "No Saved Presets"}
            replaces={!!input.prompt.trim()}
            replaceMessage="Replace the current prompt and settings with this preset?"
            onLoad={(preset) => {
              onLoad(preset);
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
                value: { input: current() },
              })
            }
            onDelete={(preset) =>
              change.mutate({ id: preset.id, method: "DELETE", deleted: preset })
            }
          />
        </ScrollArea.Autosize>
      </Stack>
    </ChipPopup>
  );
}
