import { useEffect, useRef } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Group,
  Menu,
  Progress,
  Stack,
  Table,
  Text,
  VisuallyHidden,
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
  });
  if (query.isPending) return <LoadingState label="Loading Downloads" />;
  return (
    <Stack gap="md">
      {query.error && <Alert color="red">{query.error.message}</Alert>}
      {downloads.length ? (
        <Table aria-label="Model Downloads" verticalSpacing="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>File</Table.Th>
              <Table.Th>Status</Table.Th>
              <Table.Th w={44}>
                <VisuallyHidden>Actions</VisuallyHidden>
              </Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {downloads.map((item) => {
              const running = ["downloading", "queued"].includes(item.status);
              const retry =
                ["error", "canceled", "paused"].includes(item.status) &&
                item.retryable !== false &&
                !!item.id;
              const progress = ["downloading", "paused"].includes(item.status);
              return (
                <Table.Tr key={item.id || `${item.folder}/${item.file}`}>
                  <Table.Td maw={0} w="100%">
                    <Text size="sm" fw={500} truncate>
                      {item.label || item.file}
                    </Text>
                    <Text size="xs" c="dimmed" truncate>
                      {item.folder}/{item.file}
                    </Text>
                    {progress && (
                      <Group gap="xs" wrap="nowrap" mt={4}>
                        <Progress
                          aria-label={`Downloading ${item.file}`}
                          flex={1}
                          size="sm"
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
                  </Table.Td>
                  <Table.Td>
                    <Badge
                      miw="max-content"
                      variant="light"
                      size="sm"
                      color={statusColours[item.status] || "gray"}
                    >
                      {statusLabel(item.status)}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    {(running || retry) && (
                      <Menu position="bottom-end">
                        <Menu.Target>
                          <ActionIcon
                            variant="subtle"
                            color="gray"
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
      ) : (
        !query.error && (
          <EmptyState title="No Downloads">
            Model files you download from imports or updates show here.
          </EmptyState>
        )
      )}
    </Stack>
  );
}
