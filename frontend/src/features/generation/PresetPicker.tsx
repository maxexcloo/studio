import { useState } from "react";
import { Button, Group, ScrollArea, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../api";
import type { GenerationInput, Profile, ReferenceAsset } from "../../types";
import { generationInput } from "./payload";
import {
  PickerFooter,
  PickerHeader,
  SaveCurrent,
  SavedList,
  SortMenu,
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
 * Saved presets for any generation editor, built on the same picker as LoRA stacks: search,
 * sort, load (asking before replacing a written prompt), rename, update and delete, with Save
 * Preset and Clear Preset in the footer. `onLoad` replaces that editor's draft.
 */
export function PresetPicker({
  input,
  references,
  profile,
  selection,
  onSelectionChange,
  onLoad,
  onDone,
}: {
  input: GenerationInput;
  references: ReferenceAsset[];
  profile?: Profile;
  selection: PresetSelection;
  onSelectionChange: (selection: PresetSelection) => void;
  onLoad: (preset: Preset) => void;
  /** The phone panel's closing action. */
  onDone?: () => void;
}) {
  const client = useQueryClient();
  const presets = useQuery(presetsQuery);
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
      message?: string;
      deleted?: Preset;
    }) =>
      api<{ preset?: Preset }>(
        id ? `/api/user-presets/${encodeURIComponent(id)}` : "/api/user-presets",
        json(method, value ?? {}),
      ),
    onSuccess: ({ preset }, { method, message, deleted }) => {
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
      } else if (message) notifications.show({ message });
    },
  });
  // The list arrives newest first; saved items sort undated records by their place, oldest first.
  const items = [...(presets.data?.presets || [])]
    .reverse()
    .map((preset) => ({ ...preset, name: preset.title }));
  return (
    <Stack gap="sm" flex={onDone ? 1 : undefined} mih={0}>
      <PickerHeader
        label="Presets"
        query={query}
        onQueryChange={setQuery}
        placeholder="Search presets…"
        actions={<SortMenu value={sort} onChange={setSort} />}
      />
      {presets.error && (
        <Text c="red" size="sm">
          {presets.error.message}
        </Text>
      )}
      <ScrollArea.Autosize mah={onDone ? undefined : "min(45dvh, 360px)"}>
        <SavedList
          label="Saved Presets"
          noun="Preset"
          items={savedItems(items, query, sort)}
          current={selection.presetId}
          empty={items.length ? "No Matching Presets" : "No Saved Presets"}
          replaces={!!input.prompt.trim()}
          replaceMessage="Replace the current prompt and settings with this preset?"
          onLoad={onLoad}
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
              message: "Preset updated",
            })
          }
          onDelete={(preset) => change.mutate({ id: preset.id, method: "DELETE", deleted: preset })}
        />
      </ScrollArea.Autosize>
      <PickerFooter
        start={
          <SaveCurrent
            noun="Preset"
            disabled={!input.prompt.trim()}
            onSave={(title) =>
              change.mutate({
                method: "POST",
                value: { title, input: current() },
                message: "Preset saved",
              })
            }
          />
        }
        end={
          <Button
            variant="default"
            disabled={!selection.presetId}
            onClick={() => onSelectionChange({ presetId: undefined, presetTitle: undefined })}
          >
            Clear Preset
          </Button>
        }
        done={onDone && { label: "Done", onClick: onDone }}
      />
    </Stack>
  );
}
