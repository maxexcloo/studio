import {
  Alert,
  Badge,
  Button,
  Checkbox,
  Input,
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

import { maxMenuBrief } from "../../../../shared/suggestions";
import { api, post } from "../../api";
import { ConfirmDialog, DialogFooter } from "../../ui/ConfirmDialog";
import { DataTable, TableRecord } from "../../ui/DataTable";
import { icons } from "../../ui/icons";
import { SectionHeader, SectionToolbar, ToolbarAction } from "../../ui/SectionToolbar";
import { TextBox } from "../../ui/TextBox";
import { usePhone } from "../../ui/usePhone";
import { useReturnFocus } from "../../ui/useReturnFocus";
import { assistantQuery } from "../generation/PromptAssistant";
import { type PromptStyle, type PromptStyleList, promptStylesQuery } from "./queries";

const path = "/api/profiles/prompt-styles";
const audiences = [
  { value: "everyone", label: "Everyone" },
  { value: "uncensored", label: "Uncensored Only" },
];

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
  useReturnFocus();
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
      title={style ? "Edit Template" : "New Template"}
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
          {draft.kind === "change" && (
            <Input.Wrapper label="Show In">
              <SegmentedControl
                aria-label="Show In"
                fullWidth
                data={[
                  { value: "both", label: "Edit & Recreate" },
                  { value: "edit", label: "Edit" },
                  { value: "recreate", label: "Recreate" },
                ]}
                value={draft.actions?.length === 1 ? draft.actions[0]! : "both"}
                onChange={(value) =>
                  change({
                    actions: value === "edit" || value === "recreate" ? [value] : undefined,
                  })
                }
              />
            </Input.Wrapper>
          )}
          {draft.kind === "animate" && (
            <Checkbox
              label="Modifier"
              description="Applies alongside the chosen theme."
              checked={Boolean(draft.modifier)}
              onChange={(event) => change({ modifier: event.currentTarget.checked || undefined })}
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
            label="Brief"
            description="One short line under its name in the menu, about 40 characters."
            required
            maxLength={maxMenuBrief}
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
          <Input.Wrapper
            label="Offered To"
            description="Uncensored Only styles may write explicit prompts and are offered only to accounts with Uncensored Models."
          >
            <SegmentedControl
              aria-label="Offered To"
              fullWidth
              data={audiences}
              value={draft.uncensored ? "uncensored" : "everyone"}
              onChange={(value) => change({ uncensored: value === "uncensored" || undefined })}
            />
          </Input.Wrapper>
          <DialogFooter pending={mutation.isPending} onCancel={close}>
            <Button
              type="submit"
              loading={mutation.isPending}
              disabled={
                !draft.label.trim() || !draft.description.trim() || !draft.instruction.trim()
              }
            >
              {style ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </Stack>
      </form>
    </Modal>
  );
}

/** Library › Templates: one menu's templates (Animate, Edit & Recreate or Improve Prompt), by name. */
export function PromptTemplates({
  kind,
  label,
  heading,
}: {
  kind: Kind;
  label: string;
  heading: ReactNode;
}) {
  const client = useQueryClient();
  const list = useQuery(promptStylesQuery);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<PromptStyle | null | undefined>();
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
          label={label}
          query={query}
          onQueryChange={setQuery}
          actions={
            <ToolbarAction label="New Template" icon={icons.add} onClick={() => setEditing(null)} />
          }
        />
      </SectionHeader>
      {list.data?.meta?.aiDrafted && (
        <Alert color="orange" title="AI Draft">
          <Stack gap="xs" align="start">
            <Text size="sm">These templates were drafted in chat. Review them, then approve.</Text>
            <Button size="compact-sm" loading={approve.isPending} onClick={() => approve.mutate()}>
              Approve
            </Button>
          </Stack>
        </Alert>
      )}
      {list.error ? (
        <Alert color="red">{list.error.message}</Alert>
      ) : (
        <DataTable
          label={label}
          rows={styles.filter((style) => style.kind === kind)}
          rowKey={(style) => `${style.kind}:${style.id}`}
          rowName={(style) => style.label}
          loading={list.isPending && "Loading Templates"}
          query={query}
          searchText={(style) => [style.label, style.description, style.instruction]}
          empty="No Templates"
          initialSort={{ key: "name", descending: false }}
          columns={[
            {
              key: "enabled",
              header: "Enabled",
              sortValue: (style) => Number(!style.enabled),
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
            {
              key: "name",
              header: "Name",
              sortValue: (style) => style.label,
              main: true,
              cell: (style) => (
                <TableRecord
                  name={style.label}
                  flags={
                    <>
                      {style.modifier && <Badge size="sm">Modifier</Badge>}
                      {style.uncensored && (
                        <Badge
                          size="sm"
                          color="orange"
                          leftSection={<icons.uncensored size={12} />}
                        >
                          Uncensored
                        </Badge>
                      )}
                    </>
                  }
                  detail={style.description}
                  openLabel={`Edit ${style.label}`}
                  onOpen={() => setEditing(style)}
                />
              ),
            },
          ]}
          rowActions={(style) => (
            <>
              <Menu.Item leftSection={<icons.edit size={16} />} onClick={() => setEditing(style)}>
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
      {editing !== undefined && (
        <StyleEditor
          style={editing}
          kind={kind}
          styles={styles}
          close={() => setEditing(undefined)}
        />
      )}
      <ConfirmDialog
        opened={!!deleting}
        title="Delete Template"
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
