import { Button, Group, Menu, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useState } from "react";

import { api } from "../../api";
import type { GenerationInput, Profile, ReferenceAsset } from "../../types";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import { useRemembered } from "../auth/useRemembered";
import { iconChipProps } from "./chip";
import { defaultProfile, initialInput, inputForProfile, useGeneration } from "./GenerationProvider";
import { generationInput } from "./payload";
import { ChipPopup, SaveButton, SavedName, useNaming } from "./Picker";
import {
  type Preset,
  type PresetPart,
  type PresetSelection,
  loadPresetInput,
  presetEdited,
  presetHolds,
  presetInput,
  presetParts,
  presetReplacesUnsaved,
  replaceMessage,
} from "./presets";

/** The account's saved presets, newest first. */
export const presetsQuery = queryOptions({
  queryKey: ["user-presets"],
  queryFn: () => api<{ presets: Preset[] }>("/api/user-presets"),
});
const json = (method: string, value: unknown) => ({ method, body: JSON.stringify(value) });
const defaultParts: PresetPart[] = ["prompt", "negative", "settings", "size", "loras"];

/** The account's presets, named for the shared pickers, and their edits. Deleting offers Undo. */
export function usePresets(enabled = true) {
  const client = useQueryClient();
  const presets = useQuery({ ...presetsQuery, enabled });
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
    onSuccess: (_, { deleted }) => {
      void client.invalidateQueries({ queryKey: presetsQuery.queryKey });
      if (deleted)
        notifications.show({
          message: (
            <Group justify="space-between">
              <Text size="sm">Preset deleted</Text>
              <Button
                variant="subtle"
                onClick={() => {
                  const { id: _, savedAt: __, ...value } = deleted;
                  change.mutate({ method: "POST", value });
                }}
              >
                Undo
              </Button>
            </Group>
          ),
        });
    },
  });
  return {
    ...presets,
    records: (presets.data?.presets || []).map((preset) => ({ ...preset, name: preset.title })),
    save: (value: Omit<Preset, "id" | "savedAt">) =>
      change.mutateAsync({ method: "POST", value }).then(({ preset }) => preset!),
    rename: (preset: Preset, title: string) =>
      change.mutateAsync({ id: preset.id, method: "PATCH", value: { title } }),
    update: (preset: Preset, input: GenerationInput) =>
      change.mutateAsync({ id: preset.id, method: "PATCH", value: { input } }),
    remove: (preset: Preset) => change.mutate({ id: preset.id, method: "DELETE", deleted: preset }),
  };
}

/**
 * The Presets chip and its popup for any generation editor: the preset's name, which loads, saves
 * and renames presets, with what a new one saves in its menu. `onLoad` replaces that editor's
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
  const { draftForKind, models, profiles } = useGeneration();
  const preferred = defaultProfile(models.data, input.kind);
  const defaults = generationInput(
    preferred ? inputForProfile(initialInput, preferred) : { ...initialInput, kind: input.kind },
    preferred,
    [],
  );
  const presets = usePresets(opened);
  const naming = useNaming();
  const [parts, setParts] = useRemembered("preset-parts", defaultParts);
  // A preset of every part holds them all, as one saved before parts.
  const savedParts = parts.length < presetParts.length ? parts : undefined;
  const current = () => generationInput(input, profile, references);
  const records = presets.records.map((preset) => ({ ...preset, detail: presetHolds(preset) }));
  const selected = records.find((preset) => preset.id === selection.presetId);
  const loading = (preset: Preset) => {
    const kind = preset.input.kind || input.kind;
    const other = kind !== input.kind ? draftForKind(kind) : undefined;
    const targetProfile = other
      ? profiles.find((profile) => profile.id === other.input.profileId)
      : profile;
    const target = other
      ? generationInput(other.input, targetProfile, other.references)
      : current();
    const preferred = defaultProfile(models.data, kind);
    const baseline = other
      ? generationInput(
          preferred ? inputForProfile(initialInput, preferred) : { ...initialInput, kind },
          preferred,
          [],
        )
      : defaults;
    const saved = other ? records.find((record) => record.id === other.presetId) : selected;
    const loaded = { ...initialInput, ...loadPresetInput(preset, target) };
    return { input: loaded, replaces: presetReplacesUnsaved(target, loaded, baseline, saved) };
  };
  const edited = !!selected && presetEdited(selected, current());
  const prompted = !!input.prompt.trim();
  const canSave = (savedParts || presetParts.map((part) => part.value)).some((part) =>
    part === "prompt"
      ? prompted
      : part === "negative"
        ? !!input.negative.trim()
        : part === "references"
          ? !!(references.length || input.referenceAssets.length)
          : part === "loras"
            ? !!input.loras.length
            : true,
  );
  const select = (preset?: Preset) =>
    onSelectionChange({ presetId: preset?.id, presetTitle: preset?.title });
  return (
    <ChipPopup
      title="Presets"
      tooltip
      position="top-end"
      width={360}
      floating
      opened={opened}
      onOpenedChange={setOpened}
      target={
        <Button
          {...iconChipProps}
          aria-label="Presets"
          aria-expanded={opened}
          onClick={() => setOpened(!opened)}
        >
          <icons.preset size={16} />
        </Button>
      }
      actions={
        <>
          <Button
            size="compact-sm"
            variant="subtle"
            aria-label="Clear Preset"
            disabled={!selection.presetId}
            onClick={() => select()}
          >
            Clear
          </Button>
          <SaveButton
            noun="Preset"
            naming={naming}
            current={selected}
            edited={edited}
            disabled={!canSave || !presets.isSuccess}
            onUpdate={(preset) => presets.update(preset, presetInput(current(), preset.parts))}
          />
        </>
      }
    >
      <Stack gap="sm" flex={1} mih={0}>
        {presets.isPending ? (
          <LoadingState label="Loading Presets" />
        ) : (
          <SavedName
            noun="Preset"
            naming={naming}
            records={records}
            current={selected}
            edited={edited}
            canSave={canSave}
            replaces={(preset) => (loading(preset).replaces ? replaceMessage(preset) : undefined)}
            menu={
              <>
                <Menu.Label>New Presets Save</Menu.Label>
                {presetParts.map(({ value, label }) => {
                  const checked = parts.includes(value);
                  return (
                    <Menu.Item
                      key={value}
                      closeMenuOnClick={false}
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
              </>
            }
            onLoad={(preset) => {
              onLoad(loading(preset).input, {
                presetId: preset.id,
                presetTitle: preset.title,
              });
              setOpened(false);
            }}
            onSave={(title) =>
              presets
                .save({
                  title,
                  input: presetInput(current(), savedParts),
                  parts: savedParts,
                  ...(profile?.family && (!savedParts || savedParts.includes("loras"))
                    ? { family: profile.family }
                    : {}),
                })
                .then(select)
            }
            onRename={(preset, title) =>
              presets.rename(preset, title).then(() => select({ ...preset, title }))
            }
            onDelete={(preset) => {
              presets.remove(preset);
              select();
            }}
          />
        )}
        {presets.error && (
          <Text c="red" size="sm">
            {presets.error.message}
          </Text>
        )}
      </Stack>
    </ChipPopup>
  );
}
