import {
  Alert,
  Badge,
  Button,
  Menu,
  Modal,
  SegmentedControl,
  Select,
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
import { SectionHeader, SectionToolbar, ToolbarAction } from "../../ui/SectionToolbar";
import { TextBox } from "../../ui/TextBox";
import { usePhone } from "../../ui/usePhone";
import { assistantQuery } from "../generation/PromptAssistant";
import {
  type PromptStyle,
  type PromptStyleList,
  type PromptStyleVersion,
  promptStylesQuery,
} from "./queries";

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
          <Switch
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

/** The list's saved versions; restoring one saves it as a new version. */
function StyleVersions({ hash, close }: { hash: string; close: () => void }) {
  const phone = usePhone();
  const { refresh } = useSaveStyles();
  const versions = useQuery({
    queryKey: [...promptStylesQuery.queryKey, "versions"],
    queryFn: () => api<{ versions: PromptStyleVersion[] }>(`${path}/versions`),
  });
  const restore = useMutation({
    meta: { inlineError: true },
    mutationFn: (version: number) => post(`${path}/revert`, { version, baseHash: hash }),
    onSuccess: () => {
      refresh();
      close();
    },
  });
  return (
    <Modal opened onClose={close} title="Prompt Style Versions" fullScreen={phone}>
      <Stack>
        {(versions.error || restore.error) && (
          <Alert color="red">{(versions.error || restore.error)!.message}</Alert>
        )}
        <DataTable
          label="Prompt Style Versions"
          rows={versions.data?.versions || []}
          rowKey={(entry) => `${entry.version}`}
          rowName={(entry) => `Version ${entry.version}`}
          loading={versions.isPending && "Loading Versions"}
          empty="No Versions"
          columns={[
            {
              key: "version",
              header: "Version",
              cell: (entry) => <Text size="sm">{entry.version}</Text>,
            },
            {
              key: "by",
              header: "Saved By",
              main: true,
              cell: (entry) => (
                <Text size="sm" truncate>
                  {entry.by || entry.origin}
                </Text>
              ),
            },
          ]}
          rowActions={(entry) => (
            <Menu.Item disabled={restore.isPending} onClick={() => restore.mutate(entry.version)}>
              Restore Version
            </Menu.Item>
          )}
        />
        <DialogFooter>
          <Button onClick={close}>Close</Button>
        </DialogFooter>
      </Stack>
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
  const [kind, setKind] = useState<Kind | "all">("all");
  const [editing, setEditing] = useState<{ style: PromptStyle | null; kind: Kind } | null>(null);
  const [deleting, setDeleting] = useState<PromptStyle | null>(null);
  const [versions, setVersions] = useState(false);
  const { save, refresh } = useSaveStyles();
  const styles = list.data?.styles || [];
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
            <Select
              label="Type"
              data={[{ value: "all", label: "All" }, ...kinds]}
              value={kind}
              onChange={(value) => setKind(value as Kind | "all")}
              allowDeselect={false}
              comboboxProps={{ withinPortal: false }}
            />
          }
          filterCount={Number(kind !== "all")}
          onClearFilters={() => setKind("all")}
          more={[{ label: "Versions", icon: icons.versions, onClick: () => setVersions(true) }]}
          actions={
            <ToolbarAction
              label="New Style"
              icon={icons.add}
              onClick={() => setEditing({ style: null, kind: kind === "all" ? "improve" : kind })}
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
          rows={styles.filter((style) => kind === "all" || style.kind === kind)}
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
              cell: (style) => kinds.find((kind) => kind.value === style.kind)!.label,
            },
            {
              key: "enabled",
              header: "Enabled",
              width: 96,
              cell: (style) => (
                <Switch
                  aria-label={`Enable ${style.label}`}
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
                Edit Style
              </Menu.Item>
              <Menu.Item
                color="red"
                leftSection={<icons.delete size={16} />}
                onClick={() => setDeleting(style)}
              >
                Delete Style
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
      {versions && list.data && (
        <StyleVersions hash={list.data.hash} close={() => setVersions(false)} />
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
        {`Delete ${deleting?.label}? Its version history keeps it restorable.`}
      </ConfirmDialog>
    </Stack>
  );
}
