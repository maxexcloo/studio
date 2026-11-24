import { Alert, Badge, Button, Menu, Modal, Text } from "@mantine/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useId } from "react";

import { api } from "../../api";
import { DialogFooter } from "../../ui/ConfirmDialog";
import { DataTable } from "../../ui/DataTable";
import { formatDateTime } from "../../ui/dates";
import { icons } from "../../ui/icons";
import { NameWithFlags } from "../../ui/NameWithFlags";
import { closeWhenTop } from "../../ui/popupClicks";

/** One saved version as a Versions list shows it; the server names who saved it (`savedBy`). */
interface SavedVersion {
  version: number;
  at?: string;
  savedBy: string;
  aiDrafted?: boolean;
}

/**
 * A versioned record's title with its version after it, small and dimmed (v5, or Default before
 * any edit), left out of the accessible name.
 */
export function VersionTitle({ title, version }: { title: string; version?: number | null }) {
  return (
    <>
      {title}{" "}
      <Text span size="xs" fw={400} c="dimmed" aria-hidden>
        · {version ? `v${version}` : "Default"}
      </Text>
    </>
  );
}

/**
 * A record's saved versions, newest first with the current one marked. Restore… loads the chosen
 * version (`load`) and hands its text to `onRestore`, which opens the record's editor with it as an
 * unsaved change; saving it there makes a new version.
 */
export function VersionsDialog({
  name,
  path,
  current,
  load,
  onRestore,
  close,
}: {
  /** The record's name, which titles the dialog. */
  name: string;
  /** Where its versions list is read. */
  path: string;
  current?: number | null;
  load: (version: number) => Promise<string>;
  onRestore: (text: string) => void;
  close: () => void;
}) {
  const id = useId();
  const versions = useQuery({
    queryKey: ["versions", path],
    queryFn: () => api<{ versions: SavedVersion[] }>(path),
    gcTime: 0,
  });
  const restore = useMutation({
    meta: { inlineError: true },
    mutationFn: load,
    onSuccess: (text) => {
      close();
      onRestore(text);
    },
  });
  return (
    <Modal
      opened
      id={id}
      onClose={closeWhenTop(id, close)}
      title={<VersionTitle title={`${name} Versions`} version={current} />}
      size="lg"
    >
      {versions.error && <Alert color="red">{versions.error.message}</Alert>}
      {restore.error && <Alert color="red">{restore.error.message}</Alert>}
      <DataTable
        label="Versions"
        rows={versions.data?.versions ?? []}
        rowKey={({ version }) => String(version)}
        rowName={({ version }) => `Version ${version}`}
        loading={versions.isPending && "Loading Versions"}
        empty="No Versions"
        initialSort={{ key: "version", descending: true }}
        columns={[
          {
            key: "version",
            header: "Version",
            sortValue: ({ version }) => version,
            cell: ({ version, aiDrafted }) => (
              <NameWithFlags
                name={
                  <Text size="sm" span>
                    v{version}
                  </Text>
                }
                flags={
                  (version === current || aiDrafted) && (
                    <>
                      {version === current && (
                        <Badge size="sm" color="gray">
                          Current
                        </Badge>
                      )}
                      {aiDrafted && (
                        <Badge size="sm" color="orange">
                          AI
                        </Badge>
                      )}
                    </>
                  )
                }
              />
            ),
          },
          {
            key: "saved",
            header: "Saved",
            sortValue: ({ at }) => at,
            cell: ({ at }) => (
              <Text size="sm" c="dimmed">
                {at ? formatDateTime(at) : ""}
              </Text>
            ),
          },
          {
            key: "by",
            header: "Saved By",
            main: true,
            sortValue: ({ savedBy }) => savedBy,
            cell: ({ savedBy }) => (
              <Text size="sm" truncate>
                {savedBy}
              </Text>
            ),
          },
        ]}
        rowActions={({ version }) => (
          <Menu.Item
            leftSection={<icons.reset size={16} />}
            disabled={restore.isPending}
            onClick={() => restore.mutate(version)}
          >
            Restore…
          </Menu.Item>
        )}
      />
      <DialogFooter>
        <Button onClick={close}>Done</Button>
      </DialogFooter>
    </Modal>
  );
}
