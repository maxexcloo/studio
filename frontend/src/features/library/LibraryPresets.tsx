import { Alert, Button, Menu, Modal, Stack, Text, TextInput } from "@mantine/core";
import { type ReactNode, useState } from "react";

import { ConfirmDialog, DialogFooter } from "../../ui/ConfirmDialog";
import { DataTable } from "../../ui/DataTable";
import { dateFormat } from "../../ui/dates";
import { icons } from "../../ui/icons";
import { SectionHeader, SectionToolbar } from "../../ui/SectionToolbar";
import { useGeneration } from "../generation/GenerationProvider";
import { useOpenComposer } from "../generation/openComposer";
import { type Preset, presetHolds, usePresets } from "../generation/PresetPicker";

const savedDate = dateFormat({ dateStyle: "medium" });
const savedOn = (preset: Preset) =>
  preset.savedAt ? savedDate.format(new Date(preset.savedAt)) : "";

/**
 * Library › Presets: the account's presets with what each holds. Edit in Composer loads one there,
 * where Save Preset updates it; Rename and Delete act here.
 */
export function LibraryPresets({ heading }: { heading: ReactNode }) {
  const presets = usePresets();
  const { setDraft } = useGeneration();
  const openComposer = useOpenComposer();
  const [query, setQuery] = useState("");
  const [renaming, setRenaming] = useState<Preset | null>(null);
  const [name, setName] = useState("");
  const [deleting, setDeleting] = useState<Preset | null>(null);
  const taken = presets.records.some(
    (preset) =>
      preset.id !== renaming?.id &&
      preset.title.toLocaleLowerCase() === name.trim().toLocaleLowerCase(),
  );
  const rename = () => {
    if (!renaming || !name.trim() || taken) return;
    void presets.rename(renaming, name.trim()).then(() => setRenaming(null));
  };
  const edit = (preset: Preset) => {
    setDraft((previous) => ({
      ...previous,
      // A preset of some parts leaves the rest of the draft as it is.
      input: preset.parts ? { ...previous.input, ...preset.input } : preset.input,
      presetId: preset.id,
      presetTitle: preset.title,
    }));
    openComposer(preset.input.kind === "video" ? "video" : "image");
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
              <Menu.Item leftSection={<icons.edit size={16} />} onClick={() => edit(preset)}>
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
