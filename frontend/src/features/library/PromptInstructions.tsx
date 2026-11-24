import {
  Alert,
  Box,
  Button,
  Code,
  Flex,
  Group,
  Menu,
  Modal,
  Select,
  Stack,
  Tabs,
  Text,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

import { promptVariable, promptVariables } from "../../../../shared/prompt-variables";
import { api } from "../../api";
import { DialogFooter } from "../../ui/ConfirmDialog";
import { DataTable, TableRecord, compareNames } from "../../ui/DataTable";
import { formatDateTime } from "../../ui/dates";
import { icons } from "../../ui/icons";
import { FilterChoices, SectionHeader, SectionToolbar } from "../../ui/SectionToolbar";
import { TextBox } from "../../ui/TextBox";
import { usePhone } from "../../ui/usePhone";
import { useReturnFocus } from "../../ui/useReturnFocus";
import { librarySections } from "./LibraryNavigation";
import { type PromptInstruction, promptInstructionsPath, promptInstructionsQuery } from "./queries";

const animateVariables: Record<string, string> = {
  americanEnglish: "American English wording rules.",
  availableImages:
    "What to use for the opening frame: the attached image, its caption or its prompt.",
  avoidFiller: "Rules for cutting vague or repetitive wording.",
  contentRule: "Content limits for this request.",
  data: "Instructions for treating the supplied prompt, settings and taste as data.",
  maxSuggestions: "How many ideas to offer.",
  suggestionChoices: "Motion directions and variety guidance for the opening frame.",
};

function InstructionEditor({
  instruction,
  close,
}: {
  instruction: PromptInstruction;
  close: () => void;
}) {
  const client = useQueryClient();
  const phone = usePhone();
  useReturnFocus();
  const [text, setText] = useState(instruction.text);
  const [loadedVersion, setLoadedVersion] = useState(instruction.version);
  const changeText = (value: string) => {
    setText(value);
    setLoadedVersion(null);
  };
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
  const required = promptVariables(instruction.initial);
  const present = new Set(promptVariables(text));
  const meanings = instruction.id === "suggest-motion" ? animateVariables : undefined;
  const legend = required.length > 0 && (
    <Stack gap="xs" mt="xs" component="section" aria-label="Prompt Variables">
      <Text size="sm" fw={500}>
        Prompt Variables
      </Text>
      <Text size="xs" c="dimmed">
        Keep these placeholders in double braces. Studio fills them in when it runs the instruction.
      </Text>
      <Flex
        direction={meanings ? "column" : "row"}
        wrap="wrap"
        gap="xs"
        component="ul"
        m={0}
        p={0}
        style={{ listStyle: "none" }}
      >
        {required.map((name) => (
          <Group key={name} component="li" gap="xs">
            <Code color={present.has(name) ? "blue" : "red"}>{`{{${name}}}`}</Code>
            {meanings?.[name] && (
              <Text size="xs" c="dimmed">
                {meanings[name]}
              </Text>
            )}
            {!present.has(name) && (
              <Text size="xs" c="red">
                Missing
              </Text>
            )}
          </Group>
        ))}
      </Flex>
    </Stack>
  );
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
              value={loadedVersion === null ? null : String(loadedVersion)}
              placeholder="Choose a saved version"
              allowDeselect={false}
              comboboxProps={{ withinPortal: false }}
              data={versions.map(({ version, at }) => ({
                value: String(version),
                label: at ? `v${version} · ${formatDateTime(at)}` : `v${version}`,
              }))}
              onChange={(version) => {
                const previous = versions.find((entry) => String(entry.version) === version);
                if (!previous) return;
                setText(previous.text);
                setLoadedVersion(previous.version);
              }}
            />
          )}
          <Tabs defaultValue="edit">
            <Tabs.List aria-label="Instruction View">
              <Tabs.Tab value="edit">Edit</Tabs.Tab>
              <Tabs.Tab value="preview">Preview</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="edit" pt="xs">
              <TextBox
                label="Instruction"
                autosize
                minRows={5}
                maxRows={20}
                inline
                value={text}
                onChange={changeText}
                below={legend}
              />
            </Tabs.Panel>
            <Tabs.Panel value="preview" pt="xs">
              <Box
                component="pre"
                aria-label="Highlighted Instruction"
                m={0}
                p="sm"
                mah="min(45vh, 30rem)"
                bg="var(--mantine-color-default)"
                fz="sm"
                style={{ whiteSpace: "pre-wrap", overflow: "auto", overflowWrap: "anywhere" }}
                tabIndex={0}
              >
                {text.split(promptVariable).map((part, index) =>
                  index % 2 ? (
                    <Code key={index} color={required.includes(part) ? "blue" : "red"}>
                      {`{{${part}}}`}
                    </Code>
                  ) : (
                    part
                  ),
                )}
              </Box>
              {legend}
            </Tabs.Panel>
          </Tabs>
          <DialogFooter
            pending={save.isPending}
            onCancel={close}
            secondary={[
              {
                label: "Use Default",
                onClick: () => changeText(instruction.initial),
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
  const phone = usePhone();
  return (
    <Stack gap="md">
      <SectionHeader heading={heading}>
        <SectionToolbar
          label={label}
          query={query}
          onQueryChange={setQuery}
          filters={
            <FilterChoices
              label="Type"
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
          // Sorted by name first, so the stable type sort leaves each type in name order.
          rows={instructions
            .filter((instruction) => !area || instruction.area === area)
            .sort((a, b) => compareNames(a.label, b.label))}
          rowKey={({ id }) => id}
          rowName={({ label }) => label}
          loading={list.isPending && `Loading ${label}`}
          query={query}
          searchText={({ label, area, text }) => [label, area, text]}
          empty={`No ${label}`}
          initialSort={{ key: "type", descending: false }}
          columns={[
            {
              key: "type",
              header: "Type",
              sortValue: ({ area }) => area,
              cell: ({ area }) => (
                <Text size={phone ? "xs" : "sm"} c={phone ? "dimmed" : undefined}>
                  {area}
                </Text>
              ),
            },
            {
              key: "name",
              header: "Name",
              main: true,
              sortValue: ({ label }) => label,
              cell: (instruction) => (
                <TableRecord
                  name={instruction.label}
                  openLabel={`Edit ${instruction.label}`}
                  onOpen={() => setEditing(instruction)}
                />
              ),
            },
            {
              key: "version",
              header: "Version",
              sortValue: ({ version }) => version ?? 0,
              // An edited instruction stands out from the defaults.
              cell: ({ version }) => (
                <Text
                  size={phone ? "xs" : "sm"}
                  c={version === null || phone ? "dimmed" : undefined}
                >
                  {version === null ? "Default" : `v${version}`}
                </Text>
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
