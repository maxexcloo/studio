import { useEffect, useRef } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Group,
  Menu,
  Progress,
  Stack,
  Table,
  Text,
} from "@mantine/core";
import { Ellipsis } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, failure, post } from "../../api";
import type { Models } from "../../types";
import { EmptyState } from "../../ui/EmptyState";
import { LoadingState } from "../../ui/LoadingState";
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
const bytes = (value = 0) =>
  value >= 1024 ** 3
    ? `${(value / 1024 ** 3).toFixed(1)} GiB`
    : `${(value / 1024 ** 2).toFixed(1)} MiB`;

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
    const key = item.id || `${item.folder}/${item.file}`;
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
    onError: failure,
  });
  return (
    <Stack>
      <Group justify="space-between">
        <Text size="sm" c="dimmed">
          Model files only. Cancelling keeps partial files available to resume.
        </Text>
        <Button
          variant="default"
          size="compact-sm"
          loading={query.isFetching}
          onClick={() => void query.refetch()}
        >
          Refresh Downloads
        </Button>
      </Group>
      {query.error && <Alert color="red">{query.error.message}</Alert>}
      {query.isPending ? (
        <LoadingState label="Loading Downloads" />
      ) : downloads.length ? (
        <Table.ScrollContainer minWidth={520}>
          <Table aria-label="Model Downloads" verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>File</Table.Th>
                <Table.Th>Progress & Status</Table.Th>
                <Table.Th>Actions</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {downloads.map((item) => {
                const running = ["downloading", "queued"].includes(item.status);
                const retry =
                  ["error", "canceled", "paused"].includes(item.status) &&
                  item.retryable !== false &&
                  !!item.id;
                return (
                  <Table.Tr key={item.id || `${item.folder}/${item.file}`}>
                    <Table.Td>
                      <Stack gap={2}>
                        <Text size="sm" fw={500}>
                          {item.label || item.file}
                        </Text>
                        <Text size="xs" c="dimmed" style={{ overflowWrap: "anywhere" }}>
                          {item.folder}/{item.file}
                        </Text>
                        {item.error && (
                          <Text size="sm" c="red">
                            {item.error}
                          </Text>
                        )}
                      </Stack>
                    </Table.Td>
                    <Table.Td>
                      <Stack gap="xs">
                        <Badge
                          color={
                            item.status === "error"
                              ? "red"
                              : item.status === "done"
                                ? "green"
                                : "gray"
                          }
                          style={{ alignSelf: "start" }}
                        >
                          {statusLabel(item.status)}
                        </Badge>
                        {["downloading", "paused"].includes(item.status) && (
                          <>
                            <Progress
                              aria-label={`Downloading ${item.file}`}
                              value={
                                item.totalBytes
                                  ? Math.min(
                                      100,
                                      (100 * (item.receivedBytes || 0)) / item.totalBytes,
                                    )
                                  : 0
                              }
                            />
                            <Text size="xs" c="dimmed">
                              {bytes(item.receivedBytes)}
                              {item.totalBytes ? ` / ${bytes(item.totalBytes)}` : " received"}
                            </Text>
                          </>
                        )}
                      </Stack>
                    </Table.Td>
                    <Table.Td>
                      {(running || retry) && (
                        <Menu position="bottom-end">
                          <Menu.Target>
                            <ActionIcon
                              variant="subtle"
                              aria-label={`Download Actions for ${item.file}`}
                              disabled={action.isPending}
                            >
                              <Ellipsis size={18} />
                            </ActionIcon>
                          </Menu.Target>
                          <Menu.Dropdown>
                            {running && (
                              <Menu.Item
                                color="red"
                                onClick={() => action.mutate({ id: item.id, cancel: true })}
                              >
                                Cancel Download
                              </Menu.Item>
                            )}
                            {retry && (
                              <Menu.Item
                                onClick={() => action.mutate({ id: item.id, cancel: false })}
                              >
                                {item.status === "paused" ? "Resume Download" : "Retry Download"}
                              </Menu.Item>
                            )}
                          </Menu.Dropdown>
                        </Menu>
                      )}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      ) : (
        !query.error && <EmptyState>No model downloads.</EmptyState>
      )}
    </Stack>
  );
}
