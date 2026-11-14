import { Badge, Button, Menu, Modal, Stack, Text } from "@mantine/core";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ListRestart } from "lucide-react";
import { useState } from "react";

import type { UnfinishedJob } from "../../../../shared/queue";
import { api, post } from "../../api";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { DataTable } from "../../ui/DataTable";
import { formatDateTime } from "../../ui/dates";
import { icons } from "../../ui/icons";
import { closeWhenTop } from "../../ui/popupClicks";
import { SectionToolbar, ToolbarAction } from "../../ui/SectionToolbar";
import { SettingRow } from "../../ui/SettingRows";
import { useAccount } from "../auth/AccountGate";
import { statusLabels } from "../generation/Queue";
import { accountAdminQuery } from "./AccountAdmin";

const unfinishedQuery = queryOptions({
  queryKey: ["unfinished-jobs"],
  queryFn: () => api<{ jobs: UnfinishedJob[] }>("/api/maintenance/unfinished"),
});
const count = (value: number) => value.toLocaleString();
// Every listed job at once; Retry All runs straight away, the others confirm first.
const bulk = {
  "retry-all": { label: "Retry All", icon: icons.retry },
  "cancel-all": {
    label: "Stop All",
    icon: icons.stop,
    title: "Stop All Unfinished Items",
    text: "Studio stops every listed generation. Work a worker has accepted may stay active until it confirms.",
  },
  "delete-all": {
    label: "Clear All",
    icon: icons.clear,
    title: "Clear All Unfinished Items",
    text: "Studio ends every listed generation and takes it out of the queue. Their records stay.",
  },
} as const;
type Bulk = keyof typeof bulk;

/**
 * Settings › Generation › Unfinished Items, for administrators: every account's generations that
 * have not finished, to retry, stop or clear one that is stuck, or every listed one at once.
 */
export function UnfinishedItems() {
  const client = useQueryClient();
  const [opened, setOpened] = useState(false);
  const [deleting, setDeleting] = useState<UnfinishedJob | null>(null);
  const [confirming, setConfirming] = useState<Exclude<Bulk, "retry-all">>();
  const multiUser = useAccount().data?.mode === "multi-user";
  const unfinished = useQuery({ ...unfinishedQuery, refetchInterval: opened ? 5_000 : 60_000 });
  const accounts = useQuery({ ...accountAdminQuery, enabled: multiUser && opened });
  const ownerName = (job: UnfinishedJob) =>
    accounts.data?.accounts.find((entry) => entry.id === job.ownerId)?.username || job.ownerId;
  const refresh = () => {
    for (const queryKey of [unfinishedQuery.queryKey, ["queue"], ["gallery"]])
      void client.invalidateQueries({ queryKey });
  };
  const act = useMutation({
    mutationFn: ({ action, job }: { action: "retry" | "delete"; job: UnfinishedJob }) =>
      post(`/api/maintenance/unfinished/${action}`, { ownerId: job.ownerId, id: job.id }),
    onSuccess: () => {
      refresh();
      setDeleting(null);
    },
  });
  const jobs = unfinished.data?.jobs || [];
  const actAll = useMutation({
    mutationFn: (action: Bulk) =>
      post(`/api/maintenance/unfinished/${action}`, {
        jobs: jobs.map(({ ownerId, id }) => ({ ownerId, id })),
      }),
    onSuccess: () => setConfirming(undefined),
    // Stop All may confirm only some; the list shows what is left either way.
    onSettled: refresh,
  });
  const title = (job: UnfinishedJob) =>
    String(job.input.prompt || "").trim() || `Untitled ${job.operation}`;
  return (
    <SettingRow
      label="Unfinished Items"
      description={[
        "Unfinished generations from every account, to retry, stop or clear stuck ones.",
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
      <Modal
        id="unfinished"
        opened={opened}
        onClose={closeWhenTop("unfinished", () => setOpened(false))}
        title="Unfinished Items"
        size="xl"
      >
        {jobs.length > 0 && (
          <SectionToolbar
            label="Unfinished Items"
            actions={(Object.keys(bulk) as Bulk[]).map((key) => (
              <ToolbarAction
                key={key}
                label={bulk[key].label}
                icon={bulk[key].icon}
                variant="subtle"
                color={key === "delete-all" ? "red" : "gray"}
                loading={key === "retry-all" && actAll.isPending}
                disabled={actAll.isPending}
                onClick={() => (key === "retry-all" ? actAll.mutate(key) : setConfirming(key))}
              />
            ))}
          />
        )}
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
              hideOnPhone: true,
              sortValue: (job) => job.updatedAt,
              cell: (job) => (
                <Text size="xs" style={{ whiteSpace: "nowrap" }}>
                  {formatDateTime(job.updatedAt)}
                </Text>
              ),
            },
          ]}
          rowActions={(job) => (
            <>
              <Menu.Item
                leftSection={<icons.retry size={16} />}
                onClick={() => act.mutate({ action: "retry", job })}
              >
                Retry
              </Menu.Item>
              <Menu.Divider />
              <Menu.Item
                leftSection={<icons.clear size={16} />}
                color="red"
                onClick={() => setDeleting(job)}
              >
                Clear
              </Menu.Item>
            </>
          )}
        />
      </Modal>
      <ConfirmDialog
        opened={Boolean(deleting)}
        title="Clear Unfinished Item"
        action="Clear"
        pending={act.isPending}
        onConfirm={() => deleting && act.mutate({ action: "delete", job: deleting })}
        onClose={() => setDeleting(null)}
      >
        Studio ends {deleting ? `"${title(deleting)}"` : "this item"} and takes it out of the queue.
        Its record stays.
      </ConfirmDialog>
      <ConfirmDialog
        opened={confirming !== undefined}
        title={confirming ? bulk[confirming].title : ""}
        action={confirming ? bulk[confirming].label : ""}
        pending={actAll.isPending}
        onConfirm={() => confirming && actAll.mutate(confirming)}
        onClose={() => setConfirming(undefined)}
      >
        {confirming && bulk[confirming].text}
      </ConfirmDialog>
    </SettingRow>
  );
}
