import {
  Alert,
  Box,
  Button,
  Code,
  Flex,
  Group,
  Menu,
  Modal,
  Stack,
  Tabs,
  Text,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

import { promptVariable, promptVariables } from "../../../../shared/prompt-variables";
import { api } from "../../api";
import { DialogFooter } from "../../ui/ConfirmDialog";
import { DataTable, TableRecord } from "../../ui/DataTable";
import { icons } from "../../ui/icons";
import { FilterChoices, SectionHeader, SectionToolbar } from "../../ui/SectionToolbar";
import { TextBox } from "../../ui/TextBox";
import { usePhone } from "../../ui/usePhone";
import { useReturnFocus } from "../../ui/useReturnFocus";
import { type InstructionSection, instructionAreas } from "./LibraryNavigation";
import { type PromptInstruction, promptInstructionsPath, promptInstructionsQuery } from "./queries";
import { VersionTitle, VersionsDialog } from "./Versions";

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

const instructionPath = (id: string) => `${promptInstructionsPath}/${encodeURIComponent(id)}`;

/** An instruction's editor; `restored` opens it on a saved version's text as an unsaved change. */
function InstructionEditor({
  instruction,
  restored,
  close,
}: {
  instruction: PromptInstruction;
  restored?: string;
  close: () => void;
}) {
  const client = useQueryClient();
  const phone = usePhone();
  useReturnFocus();
  const [text, changeText] = useState(restored ?? instruction.text);
  const path = instructionPath(instruction.id);
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
            ...current,
            instructions: current.instructions.map((entry) =>
              entry.id === saved.id ? saved : entry,
            ),
          },
      );
      void client.invalidateQueries({ queryKey: promptInstructionsQuery.queryKey });
      close();
    },
  });
  const examples = useQuery(promptInstructionsQuery).data?.examples ?? {};
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
    <Modal
      opened
      onClose={close}
      title={<VersionTitle title={instruction.label} version={instruction.version} />}
      size="xl"
      fullScreen={phone}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <Stack>
          {save.error && <Alert color="red">{save.error.message}</Alert>}
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
              />
              {legend}
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
                {/* Each variable reads as Studio fills it in, marked, its name on hover. */}
                {text.split(promptVariable).map((part, index) =>
                  index % 2 === 0 ? (
                    part
                  ) : required.includes(part) && Object.hasOwn(examples, part) ? (
                    <Text
                      key={index}
                      span
                      inherit
                      bg="var(--mantine-color-blue-light)"
                      title={`{{${part}}}`}
                    >
                      {examples[part]}
                    </Text>
                  ) : (
                    <Code key={index} color={required.includes(part) ? "blue" : "red"}>
                      {`{{${part}}}`}
                    </Code>
                  ),
                )}
              </Box>
              {legend}
            </Tabs.Panel>
          </Tabs>
          <DialogFooter
            pending={save.isPending}
            onCancel={close}
            leading={
              <Button
                variant="default"
                disabled={text === instruction.initial}
                onClick={() => changeText(instruction.initial)}
              >
                Use Default
              </Button>
            }
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

/** One instruction type's Library › Prompting page: its instructions, suggestion ones flagged, by name. */
export function PromptInstructions({
  section,
  heading,
}: {
  section: InstructionSection;
  heading: ReactNode;
}) {
  const { area } = instructionAreas[section];
  const label = `${area} Instructions`;
  const list = useQuery(promptInstructionsQuery);
  const [query, setQuery] = useState("");
  const [suggests, setSuggests] = useState<string | null>(null);
  const [edited, setEdited] = useState<string | null>(null);
  const [editing, setEditing] = useState<{
    instruction: PromptInstruction;
    restored?: string;
  } | null>(null);
  const [versions, setVersions] = useState<PromptInstruction | null>(null);
  const inArea = (list.data?.instructions ?? []).filter((instruction) => instruction.area === area);
  // Writes is a filter and a column only where the page holds both kinds.
  const mixed = new Set(inArea.map(({ suggestions }) => Boolean(suggestions))).size > 1;
  const writes = ({ suggestions }: PromptInstruction) =>
    suggestions ? "Suggestions" : "Prompts & Text";
  // Edited (its Version column reads vN) and Default filter only where the page holds both.
  const edits = new Set(inArea.map(({ version }) => version !== null)).size > 1;
  const instructions = inArea.filter(
    (instruction) =>
      (!mixed || !suggests || Boolean(instruction.suggestions) === (suggests === "suggestions")) &&
      (!edits || !edited || (instruction.version !== null) === (edited === "edited")),
  );
  const phone = usePhone();
  return (
    <Stack gap="md">
      <SectionHeader heading={heading}>
        <SectionToolbar
          label={label}
          query={query}
          onQueryChange={setQuery}
          {...((mixed || edits) && {
            filters: (
              <>
                {edits && (
                  <FilterChoices
                    label="Version"
                    data={[
                      { value: "default", label: "Default" },
                      { value: "edited", label: "Edited" },
                    ]}
                    value={edited}
                    onChange={setEdited}
                  />
                )}
                {mixed && (
                  <FilterChoices
                    label="Writes"
                    data={[
                      { value: "prompts", label: "Prompts & Text" },
                      { value: "suggestions", label: "Suggestions" },
                    ]}
                    value={suggests}
                    onChange={setSuggests}
                  />
                )}
              </>
            ),
            filterCount: Number(mixed && suggests !== null) + Number(edits && edited !== null),
            onClearFilters: () => {
              setSuggests(null);
              setEdited(null);
            },
          })}
        />
      </SectionHeader>
      {list.error ? (
        <Alert color="red">{list.error.message}</Alert>
      ) : (
        <DataTable
          label={label}
          rows={instructions}
          rowKey={({ id }) => id}
          rowName={({ label }) => label}
          loading={list.isPending && `Loading ${label}`}
          query={query}
          searchText={({ label, text, usedBy }) => [label, usedBy, text]}
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
                  detail={`Used by ${instruction.usedBy}`}
                  openLabel={`Edit ${instruction.label}`}
                  onOpen={() => setEditing({ instruction })}
                />
              ),
            },
            ...(mixed
              ? [
                  {
                    key: "writes",
                    header: "Writes",
                    sortValue: writes,
                    cell: (instruction: PromptInstruction) => (
                      <Text size={phone ? "xs" : "sm"} c={phone ? "dimmed" : undefined}>
                        {writes(instruction)}
                      </Text>
                    ),
                  },
                ]
              : []),
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
            <>
              <Menu.Item
                leftSection={<icons.edit size={16} />}
                onClick={() => setEditing({ instruction })}
              >
                Edit
              </Menu.Item>
              {instruction.version !== null && (
                <Menu.Item
                  leftSection={<icons.versions size={16} />}
                  onClick={() => setVersions(instruction)}
                >
                  Versions…
                </Menu.Item>
              )}
            </>
          )}
        />
      )}
      {editing && <InstructionEditor {...editing} close={() => setEditing(null)} />}
      {versions && (
        <VersionsDialog
          name={versions.label}
          path={`${instructionPath(versions.id)}/history`}
          current={versions.version}
          load={async (number) => {
            const { versions: saved } = await api<{
              versions: { version: number; text: string }[];
            }>(`${instructionPath(versions.id)}/history`);
            return saved.find(({ version }) => version === number)!.text;
          }}
          onRestore={(restored) => setEditing({ instruction: versions, restored })}
          close={() => setVersions(null)}
        />
      )}
    </Stack>
  );
}
