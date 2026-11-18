import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Menu,
  Modal,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  TextInput,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";

import { api, post } from "../../api";
import { ConfirmDialog, DialogFooter } from "../../ui/ConfirmDialog";
import { DataTable } from "../../ui/DataTable";
import { icons } from "../../ui/icons";
import {
  FilterChoices,
  SectionHeader,
  SectionToolbar,
  ToolbarAction,
} from "../../ui/SectionToolbar";
import { TextBox } from "../../ui/TextBox";
import { usePhone } from "../../ui/usePhone";
import { assistantQuery } from "../generation/PromptAssistant";
import { type PromptStyle, type PromptStyleList, promptStylesQuery } from "./queries";

const path = "/api/profiles/prompt-styles";

/** Saves the whole list over the hash it was read at, then refreshes the list and the menus. */
function useSaveStyles() {
  const client = useQueryClient();
  const refresh = () => {
    void client.invalidateQueries({ queryKey: promptStylesQuery.queryKey });
    void client.invalidateQueries({ queryKey: assistantQuery.queryKey });
  };
  // The saved list's answer becomes the cache at once, so the next edit is over its new hash.
  const save = async (styles: PromptStyle[]) => {
    const saved = await api<PromptStyleList>(path, {
      method: "PUT",
      body: JSON.stringify({
        styles,
        baseHash: client.getQueryData(promptStylesQuery.queryKey)?.hash,
      }),
    });
    client.setQueryData(promptStylesQuery.queryKey, saved);
    return saved;
  };
  return { save, refresh };
}

/** A new style's ID from its name, kept apart from the IDs already used. */
function newId(label: string, taken: string[]) {
  const base =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "style";
  let id = base === "custom" ? "custom-style" : base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}

type Kind = PromptStyle["kind"];
/** A style's ID is unique within its menu; a refetch replaces the objects an open dialog holds. */
const same = (a: PromptStyle, b: PromptStyle) => a.id === b.id && a.kind === b.kind;
/** Each kind's menu, in the order the section lists them. */
const kinds: { value: Kind; label: string }[] = [
  { value: "animate", label: "Animate" },
  { value: "change", label: "Edit" },
  { value: "improve", label: "Improve Prompt" },
];

function StyleEditor({
  style,
  kind,
  styles,
  close,
}: {
  style: PromptStyle | null;
  kind: Kind;
  styles: PromptStyle[];
  close: () => void;
}) {
  const phone = usePhone();
  const { save, refresh } = useSaveStyles();
  const [draft, setDraft] = useState<PromptStyle>(
    style || { id: "", kind, label: "", description: "", instruction: "", enabled: true },
  );
  const change = (patch: Partial<PromptStyle>) => setDraft((current) => ({ ...current, ...patch }));
  const mutation = useMutation({
    meta: { inlineError: true },
    mutationFn: () =>
      save(
        style
          ? styles.map((entry) => (same(entry, style) ? draft : entry))
          : [
              ...styles,
              {
                ...draft,
                id: newId(
                  draft.label,
                  styles.filter((entry) => entry.kind === draft.kind).map((entry) => entry.id),
                ),
              },
            ],
      ),
    onSuccess: () => {
      refresh();
      close();
    },
  });
  return (
    <Modal
      opened
      onClose={close}
      title={style ? "Edit Prompt Style" : "New Prompt Style"}
      fullScreen={phone}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          mutation.mutate();
        }}
      >
        <Stack>
          {mutation.error && <Alert color="red">{mutation.error.message}</Alert>}
          {!style && (
            <SegmentedControl
              aria-label="Menu"
              fullWidth
              data={kinds.map(({ value, label }) => ({ value, label }))}
              value={draft.kind}
              onChange={(value) => change({ kind: value as Kind })}
            />
          )}
          <TextInput
            label="Name"
            required
            data-autofocus
            value={draft.label}
            onChange={(event) => change({ label: event.currentTarget.value })}
          />
          <TextInput
            label="Description"
            description="One short line under its name in the menu."
            value={draft.description}
            onChange={(event) => change({ description: event.currentTarget.value })}
          />
          <TextBox
            label="Instruction"
            description="What the assistant writes to: the style, theme or change it applies."
            required
            autosize
            minRows={4}
            maxRows={14}
            inline
            value={draft.instruction}
            onChange={(instruction) => change({ instruction })}
          />
          <Checkbox
            label="Uncensored Models Only"
            description="Offered only to accounts with Uncensored Models, and may write explicit prompts."
            checked={draft.uncensored === true}
            onChange={(event) => change({ uncensored: event.currentTarget.checked || undefined })}
          />
          <DialogFooter pending={mutation.isPending} onCancel={close}>
            <Button
              type="submit"
              loading={mutation.isPending}
              disabled={!draft.label.trim() || !draft.instruction.trim()}
            >
              Save
            </Button>
          </DialogFooter>
        </Stack>
      </form>
    </Modal>
  );
}

/**
 * Library › Prompt Styles: the assistant's fixed options, alphabetically with a type filter.
 */
export function PromptStyles({ heading }: { heading: ReactNode }) {
  const client = useQueryClient();
  const list = useQuery(promptStylesQuery);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<Kind | null>(null);
  const [editing, setEditing] = useState<{ style: PromptStyle | null; kind: Kind } | null>(null);
  const [deleting, setDeleting] = useState<PromptStyle | null>(null);
  const { save, refresh } = useSaveStyles();
  const styles = list.data?.styles || [];
  const phone = usePhone();
  // Switches apply at once, showing the change before the save answers.
  const apply = useMutation({
    mutationFn: (next: PromptStyle[]) => {
      client.setQueryData(promptStylesQuery.queryKey, (current) =>
        current ? { ...current, styles: next } : current,
      );
      return save(next);
    },
    onSettled: refresh,
  });
  const remove = useMutation({
    meta: { inlineError: true },
    mutationFn: (style: PromptStyle) => save(styles.filter((entry) => !same(entry, style))),
    onSuccess: () => {
      refresh();
      setDeleting(null);
    },
  });
  const approve = useMutation({ mutationFn: () => post(`${path}/approve`), onSettled: refresh });
  return (
    <Stack gap="md">
      <SectionHeader heading={heading}>
        <SectionToolbar
          label="Prompt Styles"
          query={query}
          onQueryChange={setQuery}
          filters={
            <FilterChoices
              label="Type"
              data={kinds}
              value={kind}
              onChange={(value) => setKind(value as Kind | null)}
            />
          }
          filterCount={Number(!!kind)}
          onClearFilters={() => setKind(null)}
          actions={
            <ToolbarAction
              label="New Style"
              icon={icons.add}
              onClick={() => setEditing({ style: null, kind: kind ?? "improve" })}
            />
          }
        />
      </SectionHeader>
      {list.data?.meta?.aiDrafted && (
        <Alert color="orange" title="AI Draft">
          <Stack gap="xs" align="start">
            <Text size="sm">These styles were drafted in chat. Review them, then approve.</Text>
            <Button size="compact-sm" loading={approve.isPending} onClick={() => approve.mutate()}>
              Approve Draft
            </Button>
          </Stack>
        </Alert>
      )}
      {list.error ? (
        <Alert color="red">{list.error.message}</Alert>
      ) : (
        <DataTable
          label="Prompt Styles"
          rows={styles.filter((style) => !kind || style.kind === kind)}
          rowKey={(style) => `${style.kind}:${style.id}`}
          rowName={(style) => style.label}
          loading={list.isPending && "Loading Prompt Styles"}
          query={query}
          searchText={(style) => [style.label, style.description, style.instruction]}
          empty="No Prompt Styles"
          initialSort={{ key: "name", descending: false }}
          columns={[
            {
              key: "name",
              header: "Name",
              sortValue: (style) => style.label,
              main: true,
              cell: (style) => (
                <Stack gap={2}>
                  <Text size="sm" fw={500}>
                    {style.label}{" "}
                    {style.uncensored && (
                      <Badge size="sm" color="orange">
                        Uncensored
                      </Badge>
                    )}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {style.description}
                  </Text>
                </Stack>
              ),
            },
            {
              key: "kind",
              header: "Type",
              // The main column takes the free width, so the type keeps its line instead.
              cell: (style) => (
                <Text span inherit style={{ whiteSpace: "nowrap" }}>
                  {kinds.find((kind) => kind.value === style.kind)!.label}
                </Text>
              ),
            },
            {
              key: "enabled",
              header: "Enabled",
              width: 96,
              cell: (style) => (
                <Switch
                  aria-label={`Enable ${style.label}`}
                  // Phones fold the switch under the name, away from its column's heading.
                  label={phone ? "Enabled" : undefined}
                  checked={style.enabled}
                  onChange={(event) =>
                    apply.mutate(
                      styles.map((entry) =>
                        entry === style
                          ? { ...entry, enabled: event.currentTarget.checked }
                          : entry,
                      ),
                    )
                  }
                />
              ),
            },
          ]}
          rowActions={(style) => (
            <>
              <Menu.Item
                leftSection={<icons.edit size={16} />}
                onClick={() => setEditing({ style, kind: style.kind })}
              >
                Edit
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item
                color="red"
                leftSection={<icons.delete size={16} />}
                onClick={() => setDeleting(style)}
              >
                Delete
              </Menu.Item>
            </>
          )}
        />
      )}
      {editing && (
        <StyleEditor
          style={editing.style}
          kind={editing.kind}
          styles={styles}
          close={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        opened={!!deleting}
        title="Delete Style"
        action="Delete"
        pending={remove.isPending}
        error={remove.error?.message}
        onConfirm={() => deleting && remove.mutate(deleting)}
        onClose={() => setDeleting(null)}
      >
        {`Delete ${deleting?.label}?`}
      </ConfirmDialog>
    </Stack>
  );
}
