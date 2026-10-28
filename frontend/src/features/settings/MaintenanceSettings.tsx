import { useState } from "react";
import { Badge, Button, Menu, Modal, Progress, Select, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Copy,
  Download,
  ExternalLink,
  ListRestart,
  RotateCcw,
  ScanText,
  Square,
  Trash2,
} from "lucide-react";
import type { UnfinishedJob } from "../../../../shared/queue";
import { api, post } from "../../api";
import { copyText } from "../../ui/clipboard";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { DataTable } from "../../ui/DataTable";
import { useAccount, useIsAdmin } from "../auth/AccountGate";
import { statusLabels } from "../generation/Queue";
import { accountAdminQuery } from "./AccountAdmin";
import { SettingGroup, SettingRow } from "./SettingRows";

type CaptionScope = "all" | "outdated" | "missing";
/** A Caption Gallery pass (backend/domain/idle-work.ts). */
export interface CaptionStatus {
  state: "ready" | "running" | "waiting" | "stopped" | "finished" | "unavailable";
  active: boolean;
  reason: string;
  done: number;
  failed: number;
  remaining: number;
  total: number;
  scope: CaptionScope;
  scopes: Record<CaptionScope, number>;
  perMinute: number;
  etaSeconds: number | null;
}
const galleryCaptionsQuery = queryOptions({
  queryKey: ["gallery-captions"],
  queryFn: () => api<CaptionStatus>("/api/gallery/captions"),
  // Progress moves while a pass runs; otherwise only a new image changes it.
  refetchInterval: (query) => (query.state.data?.active ? 2_000 : 60_000),
});
const unfinishedQuery = queryOptions({
  queryKey: ["unfinished-jobs"],
  queryFn: () => api<{ jobs: UnfinishedJob[] }>("/api/maintenance/unfinished"),
});

const count = (value: number) => value.toLocaleString();
const eta = (seconds: number) => {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return "under a minute left";
  if (minutes < 60) return `about ${minutes} min left`;
  return `about ${Math.floor(minutes / 60)} h ${minutes % 60} min left`;
};
const stateLabel = {
  ready: "Ready",
  running: "Running",
  waiting: "Waiting for Studio to be idle",
  stopped: "Stopped",
  finished: "Finished",
  unavailable: "Unavailable",
};
const scopeLabels: Record<CaptionScope, string> = {
  all: "All",
  missing: "Missing",
  outdated: "Out of Date",
};

/** Settings › Maintenance › Caption Gallery: start or stop a captioning pass and follow it. */
function CaptionGallery() {
  const client = useQueryClient();
  const status = useQuery(galleryCaptionsQuery);
  const [chosen, setChosen] = useState<CaptionScope>("outdated");
  const change = useMutation({
    mutationFn: (action: "start" | "stop") =>
      post<CaptionStatus>(
        `/api/gallery/captions/${action}`,
        action === "start" ? { scope: chosen } : undefined,
      ),
    onSuccess: (data) => client.setQueryData(galleryCaptionsQuery.queryKey, data),
  });
  const data = status.data;
  // A running pass shows its own scope; otherwise the one to start.
  const scope = data?.active ? data.scope : chosen;
  const progress = data && data.total ? ((data.done + data.failed) / data.total) * 100 : 0;
  const summary = data && [
    data.state === "unavailable" ? `Unavailable: ${data.reason}` : stateLabel[data.state],
    data.state === "ready"
      ? `${count(data.scopes[scope])} to caption`
      : `${count(data.done)} of ${count(data.total)}`,
    data.failed && `${count(data.failed)} failed`,
    data.active && data.perMinute && `${data.perMinute} a minute`,
    data.active && data.etaSeconds !== null && eta(data.etaSeconds),
  ];
  return (
    <SettingRow
      label="Caption Gallery"
      description={
        <>
          Describe and tag images for search, as fast as the assistant model allows while Studio is
          idle. Out of Date takes missing captions and those written under older rules.
          {summary && (
            <Text span display="block" size="xs" aria-live="polite">
              {summary.filter(Boolean).join(" · ")}
            </Text>
          )}
        </>
      }
    >
      {data && (data.active || data.state === "stopped") && (
        <Progress size="sm" w={96} value={progress} aria-label="Caption Progress" />
      )}
      <Select
        aria-label="Images to Caption"
        w={150}
        data={(["all", "missing", "outdated"] as const).map((value) => ({
          value,
          label: data ? `${scopeLabels[value]} (${count(data.scopes[value])})` : scopeLabels[value],
        }))}
        value={scope}
        allowDeselect={false}
        disabled={data?.active}
        onChange={(value) => value && setChosen(value as CaptionScope)}
      />
      {data?.active ? (
        <Button
          variant="default"
          leftSection={<Square size={16} />}
          loading={change.isPending}
          onClick={() => change.mutate("stop")}
        >
          Stop
        </Button>
      ) : (
        <Button
          variant="default"
          leftSection={<ScanText size={16} />}
          loading={change.isPending}
          disabled={!data || data.state === "unavailable" || !data.scopes[scope]}
          onClick={() => change.mutate("start")}
        >
          Start
        </Button>
      )}
    </SettingRow>
  );
}

/**
 * Settings › Maintenance › Delete Failed Items: everyone deletes their own; administrators of a
 * multi-user Studio may choose another account's, or every account's.
 */
function DeleteFailedItems() {
  const client = useQueryClient();
  const account = useAccount().data;
  const others = account?.mode === "multi-user" && account.account?.role === "administrator";
  const accounts = useQuery({ ...accountAdminQuery, enabled: others });
  const [owner, setOwner] = useState("mine");
  const [confirming, setConfirming] = useState(false);
  const owners = [
    { value: "all", label: "All Users" },
    { value: "mine", label: "Mine" },
    ...(accounts.data?.accounts || [])
      .filter((entry) => entry.id !== account?.account?.id)
      .map((entry) => ({ value: entry.id, label: entry.username }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  ];
  const whose =
    owner === "all"
      ? "every account's"
      : owner === "mine"
        ? "your"
        : `${owners.find((entry) => entry.value === owner)?.label}'s`;
  const remove = useMutation({
    mutationFn: () =>
      post<{ cleared: number }>(
        "/api/gallery/errors/clear",
        owner === "mine" ? undefined : { owner },
      ),
    onSuccess: ({ cleared }) => {
      for (const queryKey of [["gallery"], ["gallery-filters"], ["queue"]])
        void client.invalidateQueries({ queryKey });
      setConfirming(false);
      notifications.show({
        message: cleared === 1 ? "1 failed item deleted" : `${count(cleared)} failed items deleted`,
      });
    },
  });
  return (
    <SettingRow
      label="Delete Failed Items"
      description="Remove failed and cancelled items from the gallery."
    >
      {others && (
        <Select
          aria-label="Whose Failed Items"
          w={150}
          data={owners}
          value={owner}
          allowDeselect={false}
          searchable={owners.length > 8}
          onChange={(value) => value && setOwner(value)}
        />
      )}
      <Button
        variant="default"
        leftSection={<Trash2 size={16} />}
        onClick={() => setConfirming(true)}
      >
        Delete
      </Button>
      <ConfirmDialog
        opened={confirming}
        title="Delete Failed Items"
        action="Delete"
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
        onClose={() => setConfirming(false)}
      >
        Remove {whose} failed and cancelled items from the gallery?
      </ConfirmDialog>
    </SettingRow>
  );
}

/**
 * Settings › Maintenance › Unfinished Items, for administrators: every account's generations that
 * have not finished, to retry or delete one that is stuck.
 */
function UnfinishedItems() {
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
    onSuccess: (_data, { action }) => {
      for (const queryKey of [unfinishedQuery.queryKey, ["queue"], ["gallery"]])
        void client.invalidateQueries({ queryKey });
      setDeleting(null);
      notifications.show({ message: action === "retry" ? "Queued again" : "Item deleted" });
    },
  });
  const jobs = unfinished.data?.jobs || [];
  const title = (job: UnfinishedJob) =>
    String(job.input.prompt || "").trim() || `Untitled ${job.operation}`;
  return (
    <SettingRow
      label="Unfinished Items"
      description={[
        "Every account's generations that haven't finished, to retry or delete one that is stuck.",
        unfinished.data && `${count(jobs.length)} now.`,
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <Button
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
                <Badge variant="light" color="gray" miw="max-content">
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
                leftSection={<Trash2 size={16} />}
                color="red"
                onClick={() => setDeleting(job)}
              >
                Delete
              </Menu.Item>
              <Menu.Item
                leftSection={<RotateCcw size={16} />}
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

/** Settings › Maintenance: clean-up and bug-report tools backed by the gallery and diagnostics routes. */
export function MaintenanceSettings() {
  const admin = useIsAdmin();
  // Read ahead so copying stays inside the tap, which Safari requires for the clipboard.
  const diagnostics = useQuery({
    queryKey: ["diagnostics"],
    queryFn: () => api<{ text: string }>("/api/diagnostics"),
    staleTime: 60_000,
  });
  return (
    <Stack gap="lg">
      <SettingGroup title="Clean Up">
        {admin && <CaptionGallery />}
        <DeleteFailedItems />
        <SettingRow
          label="Export Gallery"
          description="Download every finished image and video as one ZIP."
        >
          <Button
            component="a"
            href="/api/gallery/export"
            download
            variant="default"
            leftSection={<Download size={16} />}
          >
            Export
          </Button>
        </SettingRow>
        {admin && <UnfinishedItems />}
      </SettingGroup>
      <SettingGroup title="Help">
        <SettingRow
          label="Copy Diagnostics"
          description="Versions, system and GPU for a bug report; no prompts, images or file names."
        >
          <Button
            variant="default"
            leftSection={<Copy size={16} />}
            loading={diagnostics.isPending}
            disabled={!diagnostics.data}
            onClick={() => diagnostics.data && void copyText(diagnostics.data.text, "Diagnostics")}
          >
            Copy
          </Button>
        </SettingRow>
        <SettingRow label="Troubleshooting" description="Common errors and how to fix them.">
          <Button
            component="a"
            href="https://github.com/maxexcloo/studio/blob/main/TROUBLESHOOTING.md"
            target="_blank"
            rel="noopener noreferrer"
            variant="subtle"
            rightSection={<ExternalLink size={14} />}
          >
            Open
          </Button>
        </SettingRow>
      </SettingGroup>
    </Stack>
  );
}
