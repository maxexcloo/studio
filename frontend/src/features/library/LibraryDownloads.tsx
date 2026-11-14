import { useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, Badge, Group, Menu, Progress, Stack, Text } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, failure, post } from "../../api";
import type { Models } from "../../types";
import { formatBytes } from "../../ui/bytes";
import { DataTable } from "../../ui/DataTable";
import { icons } from "../../ui/icons";
import { SectionHeader, SectionToolbar } from "../../ui/SectionToolbar";
import { modelsQuery } from "../generation/GenerationProvider";
import {
  catalogueQuery,
  downloadsQuery,
  importsQuery,
  type DownloadState,
  type ModelDownload,
} from "./queries";

const statusLabel = (status: string) =>
  ({
    cancelled: "Cancelled",
    downloading: "Downloading",
    done: "Completed",
    failed: "Failed",
    paused: "Paused",
    queued: "Queued",
  })[status] || status;
const statusColours: Record<string, string> = {
  done: "green",
  downloading: "blue",
  error: "red",
  paused: "yellow",
};
const downloadKey = (item: ModelDownload) => item.id || `${item.folder}/${item.file}`;

export function LibraryDownloads({ heading, active }: { heading: ReactNode; active: boolean }) {
  const client = useQueryClient();
  const [search, setSearch] = useState("");
  const seenCompleted = useRef(new Set<string>());
  const query = useQuery({
    ...downloadsQuery,
    enabled: active,
    refetchInterval: active ? 2000 : false,
  });
  const unique = new Map<string, ModelDownload>();
  for (const item of [
    query.data?.active,
    ...(query.data?.queued || []),
    ...(query.data?.paused || []),
    ...(query.data?.recent || []),
  ]) {
    if (!item) continue;
    const key = downloadKey(item);
    if (!unique.has(key)) unique.set(key, item);
  }
  const downloads = [...unique.values()];
  useEffect(() => {
    if (!query.data) return;
    const completed = new Set(
      (query.data.recent || [])
        .filter((item) => item.status === "done")
        .map((item) => `${item.id}:${item.finishedAt || ""}`),
    );
    if ([...completed].some((key) => !seenCompleted.current.has(key))) {
      void api<Models>("/api/models")
        .then((models) => client.setQueryData(modelsQuery.queryKey, models))
        .catch(failure);
      for (const queryKey of [catalogueQuery.queryKey, importsQuery.queryKey])
        void client.invalidateQueries({ queryKey });
    }
    seenCompleted.current = completed;
  }, [query.data, client]);
  const action = useMutation({
    mutationFn: ({ id, cancel }: { id: string; cancel: boolean }) =>
      post<DownloadState>(cancel ? "/api/models/downloads/cancel" : "/api/models/downloads", {
        id,
      }),
    onSuccess: (state) => {
      client.setQueryData(downloadsQuery.queryKey, state);
      void client.invalidateQueries({ queryKey: downloadsQuery.queryKey });
    },
  });
  return (
    <Stack gap="md">
      <SectionHeader heading={heading}>
        <SectionToolbar
          label="Downloads"
          query={search}
          onQueryChange={downloads.length ? setSearch : undefined}
        />
      </SectionHeader>
      {/* A failed first load shows only its error, not an empty list. */}
      {query.error && !query.data ? (
        <Alert color="red">{query.error.message}</Alert>
      ) : (
        <DataTable
          label="Model Downloads"
          rows={downloads}
          rowKey={downloadKey}
          rowName={(item) => item.file}
          loading={query.isPending && "Loading Downloads"}
          query={search}
          searchText={(item) => [item.label, item.file, item.folder, statusLabel(item.status)]}
          empty="No Downloads"
          columns={[
            {
              key: "file",
              header: "File",
              main: true,
              sortValue: (item) => item.label || item.file,
              cell: (item) => (
                <>
                  <Text size="sm" fw={500} truncate>
                    {item.label || item.file}
                  </Text>
                  <Text size="xs" c="dimmed" truncate>
                    {item.folder}/{item.file}
                  </Text>
                  {["downloading", "paused"].includes(item.status) && (
                    <Group gap="xs" wrap="nowrap" mt={4}>
                      <Progress
                        aria-label={`Downloading ${item.file}`}
                        flex={1}
                        value={
                          item.totalBytes
                            ? Math.min(100, (100 * (item.receivedBytes || 0)) / item.totalBytes)
                            : 0
                        }
                      />
                      <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
                        {formatBytes(item.receivedBytes) || "0 B"}
                        {item.totalBytes ? ` / ${formatBytes(item.totalBytes)}` : ""}
                      </Text>
                    </Group>
                  )}
                  {item.error && (
                    <Text size="xs" c="red">
                      {item.error}
                    </Text>
                  )}
                </>
              ),
            },
            {
              key: "status",
              header: "Status",
              sortValue: (item) => statusLabel(item.status),
              cell: (item) => (
                <Badge miw="max-content" color={statusColours[item.status] || "gray"}>
                  {statusLabel(item.status)}
                </Badge>
              ),
            },
          ]}
          rowActions={(item) => {
            const running = ["downloading", "queued"].includes(item.status);
            const retry =
              ["failed", "cancelled", "paused"].includes(item.status) &&
              item.retryable !== false &&
              !!item.id;
            if (!running && !retry) return null;
            return (
              <>
                {running && (
                  <Menu.Item
                    color="red"
                    leftSection={<icons.stop size={16} />}
                    disabled={action.isPending}
                    onClick={() => action.mutate({ id: item.id, cancel: true })}
                  >
                    Stop Download
                  </Menu.Item>
                )}
                {retry && (
                  <Menu.Item
                    leftSection={<icons.retry size={16} />}
                    disabled={action.isPending}
                    onClick={() => action.mutate({ id: item.id, cancel: false })}
                  >
                    {item.status === "paused" ? "Resume Download" : "Retry Download"}
                  </Menu.Item>
                )}
              </>
            );
          }}
        />
      )}
    </Stack>
  );
}
