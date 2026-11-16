import { Alert, Button, Menu, Modal, Stack, Text, TextInput } from "@mantine/core";
import { type ReactNode, useState } from "react";

import { ConfirmDialog, DialogFooter } from "../../ui/ConfirmDialog";
import { DataTable } from "../../ui/DataTable";
import { dateFormat } from "../../ui/dates";
import { icons } from "../../ui/icons";
import { SectionHeader, SectionToolbar } from "../../ui/SectionToolbar";
import {
  defaultProfile,
  draftForInput,
  initialInput,
  inputForProfile,
  useGeneration,
} from "../generation/GenerationProvider";
import { useOpenComposer } from "../generation/openComposer";
import { generationInput } from "../generation/payload";
import { usePresets } from "../generation/PresetPicker";
import {
  type Preset,
  loadPresetInput,
  presetHolds,
  presetReplacesUnsaved,
} from "../generation/presets";

const savedDate = dateFormat({ dateStyle: "medium" });
const savedOn = (preset: Preset) =>
  preset.savedAt ? savedDate.format(new Date(preset.savedAt)) : "";

/**
 * Library › Presets: the account's presets with what each holds. Edit in Composer loads one there,
 * where Save Preset updates it; Rename and Delete act here.
 */
export function LibraryPresets({ heading }: { heading: ReactNode }) {
  const presets = usePresets();
  const { setDraft, draftForKind, profiles, models } = useGeneration();
  const openComposer = useOpenComposer();
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<Preset | null>(null);
  const [name, setName] = useState("");
  const [deleting, setDeleting] = useState<Preset | null>(null);
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
  return (
    <Stack gap="md">
      <SectionHeader heading={heading}>
        <SectionToolbar
          label="Presets"
          query={query}
          onQueryChange={presets.records.length ? setQuery : undefined}
        />
      </SectionHeader>
      {presets.error ? (
        <Alert color="red">{presets.error.message}</Alert>
      ) : (
        <DataTable
          label="Presets"
          rows={presets.records}
          rowKey={(preset) => preset.id}
          rowName={(preset) => preset.title}
          loading={presets.isPending && "Loading Presets"}
          query={query}
          searchText={(preset) => [preset.title, presetHolds(preset)]}
          initialSort={{ key: "name", descending: false }}
          empty="No Presets"
          columns={[
            {
              key: "name",
              header: "Name",
              main: true,
              sortValue: (preset) => preset.title,
              cell: (preset) => (
                <Text size="sm" fw={500} truncate>
                  {preset.title}
                </Text>
              ),
            },
            {
              key: "holds",
              header: "Holds",
              sortValue: presetHolds,
              cell: (preset) => (
                <Text size="sm" c="dimmed">
                  {presetHolds(preset)}
                </Text>
              ),
            },
            {
              key: "saved",
              header: "Saved",
              hideOnPhone: true,
              sortValue: (preset) => preset.savedAt,
              cell: (preset) => (
                <Text size="sm" style={{ whiteSpace: "nowrap" }}>
                  {savedOn(preset)}
                </Text>
              ),
            },
          ]}
          rowActions={(preset) => (
            <>
              <Menu.Item
                leftSection={<icons.edit size={16} />}
                onClick={() => {
                  if (loading(preset).replaces) setReplacing(preset);
                  else edit(preset);
                }}
              >
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
          )}
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
        title="Delete Preset"
        action="Delete"
        pending={false}
        onConfirm={() => {
          if (deleting) presets.remove(deleting);
          setDeleting(null);
        }}
        onClose={() => setDeleting(null)}
      >
        Delete {deleting?.title}? Drafts made from it stay as they are.
      </ConfirmDialog>
    </Stack>
  );
}
