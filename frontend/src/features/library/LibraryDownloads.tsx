import { useEffect, useRef } from "react";
import { Alert, Badge, Group, Menu, Progress, Stack, Text } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, failure, post } from "../../api";
import type { Models } from "../../types";
import { DataTable } from "../../ui/DataTable";
import { modelsQuery } from "../generation/GenerationProvider";

interface ModelDownload {
  id: string;
  file: string;
  folder: string;
  label?: string;
  status: string;
  error?: string;
  retryable?: boolean;
  receivedBytes?: number;
  totalBytes?: number;
  finishedAt?: string;
}
interface DownloadState {
  active?: ModelDownload | null;
  queued?: ModelDownload[];
  paused?: ModelDownload[];
  recent?: ModelDownload[];
}
const statusLabel = (status: string) =>
  ({
    canceled: "Cancelled",
    downloading: "Downloading",
    done: "Completed",
    error: "Failed",
    paused: "Paused",
    queued: "Queued",
  })[status] || status;
const statusColours: Record<string, string> = {
  done: "green",
  downloading: "blue",
  error: "red",
  paused: "yellow",
};
const bytes = (value = 0) =>
  value >= 1024 ** 3
    ? `${(value / 1024 ** 3).toFixed(1)} GiB`
    : `${(value / 1024 ** 2).toFixed(1)} MiB`;

const downloadKey = (item: ModelDownload) => item.id || `${item.folder}/${item.file}`;

export function LibraryDownloads({ active }: { active: boolean }) {
  const client = useQueryClient();
  const seenCompleted = useRef(new Set<string>());
  const query = useQuery({
    queryKey: ["library-downloads"],
    queryFn: () => api<DownloadState>("/api/models/downloads"),
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
      for (const queryKey of [["library"], ["imports"]])
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
      client.setQueryData(["library-downloads"], state);
      void client.invalidateQueries({ queryKey: ["library-downloads"] });
    },
  });
  return (
    <Stack gap="md">
      {query.error && <Alert color="red">{query.error.message}</Alert>}
      {/* A failed first load shows only its error, not an empty list. */}
      {(query.data || query.isPending) && (
        <DataTable
          label="Model Downloads"
          rows={downloads}
          rowKey={downloadKey}
          rowName={(item) => item.file}
          loading={query.isPending && "Loading Downloads"}
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
                        {bytes(item.receivedBytes)}
                        {item.totalBytes ? ` / ${bytes(item.totalBytes)}` : ""}
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
              ["error", "canceled", "paused"].includes(item.status) &&
              item.retryable !== false &&
              !!item.id;
            if (!running && !retry) return null;
            return (
              <>
                {running && (
                  <Menu.Item
                    color="red"
                    disabled={action.isPending}
                    onClick={() => action.mutate({ id: item.id, cancel: true })}
                  >
                    Cancel Download
                  </Menu.Item>
                )}
                {retry && (
                  <Menu.Item
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
