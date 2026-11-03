import { useState } from "react";
import { Badge, Button, Menu, Modal, Stack, Text } from "@mantine/core";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListRestart } from "lucide-react";
import { icons } from "../../ui/icons";
import type { UnfinishedJob } from "../../../../shared/queue";
import { api, post } from "../../api";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { DataTable } from "../../ui/DataTable";
import { SettingRow } from "../../ui/SettingRows";
import { useAccount } from "../auth/AccountGate";
import { statusLabels } from "../generation/Queue";
import { accountAdminQuery } from "./AccountAdmin";

const unfinishedQuery = queryOptions({
  queryKey: ["unfinished-jobs"],
  queryFn: () => api<{ jobs: UnfinishedJob[] }>("/api/maintenance/unfinished"),
});
const count = (value: number) => value.toLocaleString();

/**
 * Settings › Generation › Unfinished Items, for administrators: every account's generations that
 * have not finished, to retry or delete one that is stuck.
 */
export function UnfinishedItems() {
  const client = useQueryClient();
  const [opened, setOpened] = useState(false);
  const [deleting, setDeleting] = useState<UnfinishedJob | null>(null);
  const multiUser = useAccount().data?.mode === "multi-user";
  const unfinished = useQuery({ ...unfinishedQuery, refetchInterval: opened ? 5_000 : 60_000 });
  const accounts = useQuery({ ...accountAdminQuery, enabled: multiUser && opened });
  const ownerName = (job: UnfinishedJob) =>
    accounts.data?.accounts.find((entry) => entry.id === job.ownerId)?.username || job.ownerId;
  const act = useMutation({
    mutationFn: ({ action, job }: { action: "retry" | "delete"; job: UnfinishedJob }) =>
      post(`/api/maintenance/unfinished/${action}`, { ownerId: job.ownerId, id: job.id }),
    onSuccess: () => {
      for (const queryKey of [unfinishedQuery.queryKey, ["queue"], ["gallery"]])
        void client.invalidateQueries({ queryKey });
      setDeleting(null);
    },
  });
  const jobs = unfinished.data?.jobs || [];
  const title = (job: UnfinishedJob) =>
    String(job.input.prompt || "").trim() || `Untitled ${job.operation}`;
  return (
    <SettingRow
      label="Unfinished Items"
      description={[
        "Unfinished generations from every account, to retry or delete stuck ones.",
        unfinished.data && `${count(jobs.length)} now.`,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Button
        size="compact-sm"
        variant="default"
        leftSection={<ListRestart size={16} />}
        onClick={() => setOpened(true)}
      >
        Review
      </Button>
      <Modal opened={opened} onClose={() => setOpened(false)} title="Unfinished Items" size="xl">
        <DataTable
          label="Unfinished Items"
          rows={jobs}
          rowKey={(job) => `${job.ownerId}/${job.id}`}
          rowName={title}
          loading={unfinished.isPending && "Loading Unfinished Items"}
          empty="No Unfinished Items"
          columns={[
            {
              key: "item",
              header: "Item",
              main: true,
              sortValue: title,
              cell: (job) => (
                <Stack gap={0} miw={0}>
                  <Text size="sm" truncate>
                    {title(job)}
                  </Text>
                  <Text size="xs" c="dimmed" truncate>
                    {[job.dream && "Dream", job.reason, multiUser && ownerName(job)]
                      .filter(Boolean)
                      .join(" · ")}
                  </Text>
                </Stack>
              ),
            },
            {
              key: "status",
              header: "Status",
              sortValue: (job) => statusLabels[job.status],
              cell: (job) => (
                <Badge color="gray" miw="max-content">
                  {statusLabels[job.status]}
                </Badge>
              ),
            },
            {
              key: "updated",
              header: "Updated",
              visibleFrom: "sm",
              sortValue: (job) => job.updatedAt,
              cell: (job) => (
                <Text size="xs" style={{ whiteSpace: "nowrap" }}>
                  {new Date(job.updatedAt).toLocaleString()}
                </Text>
              ),
            },
          ]}
          rowActions={(job) => (
            <>
              <Menu.Item
                leftSection={<icons.delete size={16} />}
                color="red"
                onClick={() => setDeleting(job)}
              >
                Delete
              </Menu.Item>
              <Menu.Item
                leftSection={<icons.retry size={16} />}
                onClick={() => act.mutate({ action: "retry", job })}
              >
                Retry
              </Menu.Item>
            </>
          )}
        />
      </Modal>
      <ConfirmDialog
        opened={Boolean(deleting)}
        title="Delete Unfinished Item"
        action="Delete"
        pending={act.isPending}
        onConfirm={() => deleting && act.mutate({ action: "delete", job: deleting })}
        onClose={() => setDeleting(null)}
      >
        End {deleting ? `"${title(deleting)}"` : "this item"} and take it out of the queue?
      </ConfirmDialog>
    </SettingRow>
  );
}
