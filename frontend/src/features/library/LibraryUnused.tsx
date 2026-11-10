import { useState, type ReactNode } from "react";
import { Alert, Menu, Stack, Text } from "@mantine/core";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, post } from "../../api";
import { formatBytes } from "../../ui/bytes";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { DataTable } from "../../ui/DataTable";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import { SectionHeader, SectionToolbar } from "../../ui/SectionToolbar";

interface UnusedItem {
  key: string;
  title: string;
  kind?: string;
  bytes: number;
  reason: string;
}

/** Installed entries no profile uses, and LoRAs no run used in 90 days. */
export const unusedQuery = queryOptions({
  queryKey: ["library-unused"],
  queryFn: () => api<{ items: UnusedItem[] }>("/api/library/unused"),
});

/** Library › Unused: what could go to free space, removed through the catalogue's own Remove. */
export function LibraryUnused({ heading }: { heading: ReactNode }) {
  const client = useQueryClient();
  const unused = useQuery(unusedQuery);
  const [query, setQuery] = useState("");
  const [removing, setRemoving] = useState<UnusedItem | null>(null);
  const remove = useMutation({
    meta: { inlineError: true },
    mutationFn: (item: UnusedItem) => post("/api/library/catalogue/remove", { key: item.key }),
    onSuccess: () => setRemoving(null),
    onSettled: () =>
      Promise.all(
        [unusedQuery.queryKey, ["library"]].map((queryKey) =>
          client.invalidateQueries({ queryKey }),
        ),
      ),
  });
  const items = unused.data?.items || [];
  const total = items.reduce((sum, item) => sum + item.bytes, 0);
  return (
    <Stack gap="md">
      <SectionHeader heading={heading}>
        <SectionToolbar
          label="Unused"
          query={query}
          onQueryChange={items.length ? setQuery : undefined}
        />
      </SectionHeader>
      {unused.error ? (
        <Alert color="red">{unused.error.message}</Alert>
      ) : unused.isPending ? (
        <LoadingState label="Loading Unused" fill />
      ) : (
        <>
          {total > 0 && (
            <Text c="dimmed" size="xs">
              {formatBytes(total)} in {items.length} {items.length === 1 ? "file" : "files"}.
            </Text>
          )}
          <DataTable
            label="Unused Models"
            rows={items}
            rowKey={(item) => item.key}
            rowName={(item) => item.title}
            query={query}
            searchText={(item) => [item.title, item.key]}
            initialSort={{ key: "size", descending: true }}
            empty="Nothing Unused"
            columns={[
              {
                key: "name",
                header: "Name",
                main: true,
                sortValue: (item) => item.title,
                cell: (item) => (
                  <>
                    <Text size="sm" fw={500} truncate>
                      {item.title}
                    </Text>
                    <Text size="xs" c="dimmed" truncate>
                      {item.key}
                    </Text>
                  </>
                ),
              },
              {
                key: "reason",
                header: "Why",
                sortValue: (item) => item.reason,
                cell: (item) => (
                  <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                    {item.reason}
                  </Text>
                ),
              },
              {
                key: "size",
                header: "Size",
                sortValue: (item) => item.bytes || undefined,
                cell: (item) => (
                  <Text size="sm" style={{ whiteSpace: "nowrap" }}>
                    {formatBytes(item.bytes) || "Unknown"}
                  </Text>
                ),
              },
            ]}
            rowActions={(item) => (
              <Menu.Item
                color="red"
                leftSection={<icons.delete size={16} />}
                onClick={() => {
                  remove.reset();
                  setRemoving(item);
                }}
              >
                Remove
              </Menu.Item>
            )}
          />
        </>
      )}
      <ConfirmDialog
        opened={Boolean(removing)}
        title="Remove"
        action="Remove"
        pending={remove.isPending}
        error={remove.error?.message}
        onConfirm={() => removing && remove.mutate(removing)}
        onClose={() => setRemoving(null)}
      >
        Remove {removing?.title} from the catalogue and delete its file? A LoRA also leaves every
        account’s stacks.
      </ConfirmDialog>
    </Stack>
  );
}
