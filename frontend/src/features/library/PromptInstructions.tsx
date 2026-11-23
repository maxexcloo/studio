import { Alert, Button, Menu, Modal, Select, Stack, Text } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

import { api } from "../../api";
import { DialogFooter } from "../../ui/ConfirmDialog";
import { DataTable, TableRecord } from "../../ui/DataTable";
import { icons } from "../../ui/icons";
import { FilterChoices, SectionHeader, SectionToolbar } from "../../ui/SectionToolbar";
import { TextBox } from "../../ui/TextBox";
import { usePhone } from "../../ui/usePhone";
import { librarySections } from "./LibraryNavigation";
import { type PromptInstruction, promptInstructionsPath, promptInstructionsQuery } from "./queries";

function InstructionEditor({
  instruction,
  close,
}: {
  instruction: PromptInstruction;
  close: () => void;
}) {
  const client = useQueryClient();
  const phone = usePhone();
  const [text, setText] = useState(instruction.text);
  const path = `${promptInstructionsPath}/${encodeURIComponent(instruction.id)}`;
  const history = useQuery({
    queryKey: [...promptInstructionsQuery.queryKey, instruction.id, "history"],
    queryFn: () =>
      api<{ versions: { version: number; text: string; at: string }[] }>(`${path}/history`),
    enabled: instruction.version !== null,
  });
  const save = useMutation({
    meta: { inlineError: true },
    mutationFn: () =>
      api<PromptInstruction>(path, {
        method: "PUT",
        body: JSON.stringify({ text, baseHash: instruction.hash }),
      }),
    onSuccess: (saved) => {
      client.setQueryData(
        promptInstructionsQuery.queryKey,
        (current) =>
          current && {
            instructions: current.instructions.map((entry) =>
              entry.id === saved.id ? saved : entry,
            ),
          },
      );
      void client.invalidateQueries({ queryKey: promptInstructionsQuery.queryKey });
      close();
    },
  });
  const versions = history.data?.versions ?? [];
  return (
    <Modal opened onClose={close} title={instruction.label} size="xl" fullScreen={phone}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <Stack>
          {save.error && <Alert color="red">{save.error.message}</Alert>}
          {history.error && <Alert color="red">{history.error.message}</Alert>}
          {versions.length > 0 && (
            <Select
              label="Load Version"
              value={null}
              placeholder="Choose a saved version"
              data={versions.map(({ version }) => ({
                value: String(version),
                label: `v${version}`,
              }))}
              onChange={(version) => {
                const previous = versions.find((entry) => String(entry.version) === version);
                if (previous) setText(previous.text);
              }}
            />
          )}
          <TextBox
            label="Instruction"
            description="Keep the placeholders in double braces. Studio fills them with the relevant guide, reference, request or settings at run time."
            autosize
            minRows={5}
            maxRows={20}
            inline
            value={text}
            onChange={setText}
          />
          <DialogFooter
            pending={save.isPending}
            onCancel={close}
            secondary={[
              {
                label: "Use Default",
                onClick: () => setText(instruction.initial),
                disabled: text === instruction.initial,
              },
            ]}
          >
            <Button
              type="submit"
              loading={save.isPending}
              disabled={!text.trim() || text === instruction.text}
            >
              Save
            </Button>
          </DialogFooter>
        </Stack>
      </form>
    </Modal>
  );
}

export function PromptInstructions({
  section,
  heading,
}: {
  section: "promptInstructions" | "suggestionInstructions";
  heading: ReactNode;
}) {
  const { label } = librarySections[section];
  const list = useQuery(promptInstructionsQuery);
  const [query, setQuery] = useState("");
  const [area, setArea] = useState<string | null>(null);
  const [editing, setEditing] = useState<PromptInstruction | null>(null);
  const instructions = (list.data?.instructions ?? []).filter(
    ({ suggestions }) => Boolean(suggestions) === (section === "suggestionInstructions"),
  );
  const areas = [...new Set(instructions.map(({ area }) => area))].sort();
  return (
    <Stack gap="md">
      <SectionHeader heading={heading}>
        <SectionToolbar
          label={label}
          query={query}
          onQueryChange={setQuery}
          filters={
            <FilterChoices
              label="Area"
              data={areas.map((value) => ({ value, label: value }))}
              value={area}
              onChange={setArea}
            />
          }
          filterCount={Number(area !== null)}
          onClearFilters={() => setArea(null)}
        />
      </SectionHeader>
      {list.error ? (
        <Alert color="red">{list.error.message}</Alert>
      ) : (
        <DataTable
          label={label}
          rows={instructions.filter((instruction) => !area || instruction.area === area)}
          rowKey={({ id }) => id}
          rowName={({ label }) => label}
          loading={list.isPending && `Loading ${label}`}
          query={query}
          searchText={({ label, area, text }) => [label, area, text]}
          empty={`No ${label}`}
          initialSort={{ key: "name", descending: false }}
          columns={[
            {
              key: "name",
              header: "Name",
              main: true,
              sortValue: ({ label }) => label,
              cell: (instruction) => (
                <TableRecord
                  name={instruction.label}
                  detail={instruction.area}
                  openLabel={`Edit ${instruction.label}`}
                  onOpen={() => setEditing(instruction)}
                />
              ),
            },
            {
              key: "version",
              header: "Version",
              sortValue: ({ version }) => version ?? 0,
              cell: ({ version }) => (
                <Text size="sm">{version === null ? "Default" : `v${version}`}</Text>
              ),
            },
          ]}
          rowActions={(instruction) => (
            <Menu.Item
              leftSection={<icons.edit size={16} />}
              onClick={() => setEditing(instruction)}
            >
              Edit
            </Menu.Item>
          )}
        />
      )}
      {editing && <InstructionEditor instruction={editing} close={() => setEditing(null)} />}
    </Stack>
  );
}
