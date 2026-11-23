import { Alert, Button, Menu, Modal, Stack, Text, TextInput } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { type ReactNode, useState } from "react";

import { ConfirmDialog, DialogFooter } from "../../ui/ConfirmDialog";
import { DataTable, TableRecord, compareNames } from "../../ui/DataTable";
import { formatDate, formatDateTime } from "../../ui/dates";
import { icons } from "../../ui/icons";
import { SectionHeader, SectionToolbar, ToolbarAction } from "../../ui/SectionToolbar";
import { SelectionBar } from "../../ui/SelectionBar";
import { usePhone } from "../../ui/usePhone";
import {
  defaultProfile,
  draftForInput,
  initialInput,
  inputForProfile,
  useGeneration,
} from "../generation/GenerationProvider";
import { modelFamilyLabel } from "../generation/modelFamily";
import { useOpenComposer } from "../generation/openComposer";
import { generationInput, profileName } from "../generation/payload";
import { useDeletePresets, usePresets } from "../generation/PresetPicker";
import {
  type Preset,
  loadPresetInput,
  presetHolds,
  presetReplacesUnsaved,
} from "../generation/presets";

const kindLabels = { image: "Image", video: "Video" };
const kindOf = (preset: Preset) => kindLabels[preset.input.kind || "image"];

/**
 * Library › Presets: the account's presets with what each holds. Selecting a name loads it in Composer,
 * where Save Preset updates it; Rename and Delete act here.
 */
export function LibraryPresets({ heading }: { heading: ReactNode }) {
  const phone = usePhone();
  const presets = usePresets();
  const bulkDelete = useDeletePresets();
  const { setDraft, draftForKind, profiles, models } = useGeneration();
  const openComposer = useOpenComposer();
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<Preset | null>(null);
  const [name, setName] = useState("");
  const [deleting, setDeleting] = useState<Preset | "selected" | null>(null);
  const [selection, setSelection] = useState<Set<string> | null>(null);
  const selected = presets.records.filter(({ id }) => selection?.has(id));
  const [replacing, setReplacing] = useState<Preset | null>(null);
  const taken = presets.records.some(
    (preset) =>
      preset.id !== renaming?.id &&
      preset.title.toLocaleLowerCase() === name.trim().toLocaleLowerCase(),
  );
  const rename = () => {
    if (!renaming || !name.trim() || taken) return;
    void presets.rename(renaming, name.trim()).then(() => setRenaming(null));
  };
  const loading = (preset: Preset) => {
    const kind = preset.input.kind || "image";
    const previous = draftForKind(kind);
    const current = generationInput(
      previous.input,
      profiles.find((profile) => profile.id === previous.input.profileId),
      previous.references,
    );
    const preferred = defaultProfile(models.data, kind);
    const defaults = generationInput(
      preferred ? inputForProfile(initialInput, preferred) : { ...initialInput, kind },
      preferred,
      [],
    );
    const input = { ...initialInput, ...loadPresetInput(preset, current) };
    const selected = presets.records.find((record) => record.id === previous.presetId);
    return { kind, input, replaces: presetReplacesUnsaved(current, input, defaults, selected) };
  };
  const edit = (preset: Preset) => {
    const { kind, input } = loading(preset);
    setDraft(
      draftForInput(input, {
        presetId: preset.id,
        presetTitle: preset.title,
      }),
    );
    openComposer(kind);
  };
  const open = (preset: Preset) => {
    if (loading(preset).replaces) setReplacing(preset);
    else edit(preset);
  };
  // The model a preset loads, where it holds the settings; else the family its LoRAs were chosen for.
  const modelOf = (preset: Preset) => {
    const profile =
      (!preset.parts || preset.parts.includes("settings")) &&
      profiles.find((entry) => entry.id === preset.input.profileId);
    return profile
      ? profileName(profile)
      : preset.family
        ? modelFamilyLabel(preset.family)
        : undefined;
  };
  const secondary = { size: phone ? "xs" : "sm", c: phone ? "dimmed" : undefined } as const;
  return (
    <Stack gap="md">
      <SectionHeader heading={heading}>
        <SectionToolbar
          label="Presets"
          query={query}
          onQueryChange={presets.records.length ? setQuery : undefined}
          actions={
            <ToolbarAction
              label="Select"
              icon={icons.select}
              iconOnly
              variant="default"
              aria-pressed={selection !== null}
              disabled={(!selection && !presets.records.length) || bulkDelete.isPending}
              onClick={() => {
                bulkDelete.reset();
                setSelection(selection ? null : new Set());
              }}
            />
          }
        />
      </SectionHeader>
      {selection && (
        <SelectionBar label="Preset Selection" count={selected.length} busy={bulkDelete.isPending}>
          <ToolbarAction
            label="Delete"
            icon={icons.delete}
            color="red"
            variant="subtle"
            disabled={!selected.length || bulkDelete.isPending}
            onClick={() => setDeleting("selected")}
          />
        </SelectionBar>
      )}
      {presets.error ? (
        <Alert color="red">{presets.error.message}</Alert>
      ) : (
        <DataTable
          label="Presets"
          // Sorted by name first, so the stable type sort leaves each type in name order.
          rows={[...presets.records].sort((a, b) => compareNames(a.title, b.title))}
          rowKey={(preset) => preset.id}
          rowName={(preset) => preset.title}
          loading={presets.isPending && "Loading Presets"}
          query={query}
          searchText={(preset) => [
            preset.title,
            kindOf(preset),
            modelOf(preset),
            presetHolds(preset),
          ]}
          initialSort={{ key: "type", descending: false }}
          empty="No Presets"
          selection={
            selection
              ? {
                  selected: selection,
                  disabled: bulkDelete.isPending,
                  onChange: (ids, checked) =>
                    setSelection((previous) => {
                      const next = new Set(previous);
                      for (const id of ids) {
                        if (checked) next.add(id);
                        else next.delete(id);
                      }
                      return next;
                    }),
                }
              : undefined
          }
          columns={[
            {
              key: "type",
              header: "Type",
              sortValue: kindOf,
              cell: (preset) => <Text {...secondary}>{kindOf(preset)}</Text>,
            },
            {
              key: "name",
              header: "Name",
              main: true,
              sortValue: (preset) => preset.title,
              cell: (preset) => (
                <TableRecord
                  name={preset.title}
                  openLabel={`Edit ${preset.title} in Composer`}
                  onOpen={selection ? undefined : () => open(preset)}
                />
              ),
            },
            {
              key: "model",
              header: "Model",
              sortValue: modelOf,
              cell: (preset) =>
                modelOf(preset) && (
                  <Text {...secondary} style={{ whiteSpace: "nowrap" }}>
                    {modelOf(preset)}
                  </Text>
                ),
            },
            {
              key: "holds",
              header: "Holds",
              sortValue: presetHolds,
              cell: (preset) => (
                <Text size={phone ? "xs" : "sm"} c="dimmed">
                  {presetHolds(preset)}
                </Text>
              ),
            },
            {
              key: "saved",
              header: "Saved",
              sortValue: (preset) => preset.savedAt,
              cell: (preset) =>
                preset.savedAt && (
                  <Text
                    {...secondary}
                    title={formatDateTime(preset.savedAt)}
                    style={{ whiteSpace: "nowrap" }}
                  >
                    {formatDate(preset.savedAt)}
                  </Text>
                ),
            },
          ]}
          rowActions={
            selection
              ? undefined
              : (preset) => (
                  <>
                    <Menu.Item leftSection={<icons.edit size={16} />} onClick={() => open(preset)}>
                      Edit in Composer
                    </Menu.Item>
                    <Menu.Item
                      leftSection={<icons.rename size={16} />}
                      onClick={() => {
                        setName(preset.title);
                        setRenaming(preset);
                      }}
                    >
                      Rename
                    </Menu.Item>
                    <Menu.Divider />
                    <Menu.Item
                      color="red"
                      leftSection={<icons.delete size={16} />}
                      onClick={() => setDeleting(preset)}
                    >
                      Delete
                    </Menu.Item>
                  </>
                )
          }
        />
      )}
      <Modal opened={!!renaming} onClose={() => setRenaming(null)} title="Rename Preset">
        <Stack gap="md">
          <TextInput
            label="Name"
            data-autofocus
            value={name}
            error={taken && "A preset has this name"}
            onChange={(event) => setName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) rename();
            }}
          />
          <DialogFooter onCancel={() => setRenaming(null)}>
            <Button disabled={!name.trim() || taken} onClick={rename}>
              Save
            </Button>
          </DialogFooter>
        </Stack>
      </Modal>
      <ConfirmDialog
        opened={!!replacing}
        title="Load Preset"
        action="Replace"
        pending={false}
        onConfirm={() => {
          if (replacing) edit(replacing);
          setReplacing(null);
        }}
        onClose={() => setReplacing(null)}
      >
        Replace the draft's saved parts with {replacing?.title}? Other parts of a partial preset
        stay as they are.
      </ConfirmDialog>
      <ConfirmDialog
        opened={!!deleting}
        title={deleting === "selected" ? "Delete Presets" : "Delete Preset"}
        action="Delete"
        pending={bulkDelete.isPending}
        disabled={deleting === "selected" && !selected.length}
        onConfirm={() => {
          if (deleting === "selected") {
            bulkDelete.mutate(selected, {
              onSuccess: ({ failed }) => {
                setSelection(failed.length ? new Set(failed.map(({ id }) => id)) : null);
                setDeleting(null);
                if (failed.length)
                  notifications.show({
                    color: "red",
                    message: `Couldn't delete ${failed.length} ${failed.length === 1 ? "preset" : "presets"}.`,
                  });
              },
            });
          } else if (deleting) {
            presets.remove(deleting);
            setDeleting(null);
          }
        }}
        onClose={() => setDeleting(null)}
      >
        {deleting === "selected"
          ? `Delete ${selected.length} ${selected.length === 1 ? "preset" : "presets"}? Drafts made from them stay as they are.`
          : `Delete ${deleting?.title}? Drafts made from it stay as they are.`}
      </ConfirmDialog>
    </Stack>
  );
}
