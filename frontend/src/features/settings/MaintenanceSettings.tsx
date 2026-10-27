import { Button, Progress, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Download, Eraser, ExternalLink, ScanText, Square } from "lucide-react";
import { api, post } from "../../api";
import { copyText } from "../../ui/clipboard";
import { useIsAdmin } from "../auth/AccountGate";
import { SettingGroup, SettingRow } from "./SettingRows";

/** A Caption Gallery pass (backend/domain/idle-work.ts). */
export interface CaptionStatus {
  state: "ready" | "running" | "waiting" | "stopped" | "finished" | "unavailable";
  active: boolean;
  reason: string;
  done: number;
  failed: number;
  remaining: number;
  total: number;
  perMinute: number;
  etaSeconds: number | null;
}
const galleryCaptionsQuery = queryOptions({
  queryKey: ["gallery-captions"],
  queryFn: () => api<CaptionStatus>("/api/gallery/captions"),
  // Progress moves while a pass runs; otherwise only a new image changes it.
  refetchInterval: (query) => (query.state.data?.active ? 2_000 : 60_000),
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

/** Settings › Maintenance › Caption Gallery: start or stop a full captioning pass and follow it. */
function CaptionGallery() {
  const client = useQueryClient();
  const status = useQuery(galleryCaptionsQuery);
  const change = useMutation({
    mutationFn: (action: "start" | "stop") =>
      post<CaptionStatus>(`/api/gallery/captions/${action}`),
    onSuccess: (data) => client.setQueryData(galleryCaptionsQuery.queryKey, data),
  });
  const data = status.data;
  const progress = data && data.total ? ((data.done + data.failed) / data.total) * 100 : 0;
  const summary = data && [
    data.state === "unavailable" ? `Unavailable: ${data.reason}` : stateLabel[data.state],
    data.state === "ready"
      ? `${count(data.remaining)} to caption`
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
          Describe every image without a current caption, as fast as the assistant model allows
          while Studio is idle.
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
      {data?.active ? (
        <Button
          variant="default"
          size="compact-sm"
          leftSection={<Square size={16} />}
          loading={change.isPending}
          onClick={() => change.mutate("stop")}
        >
          Stop
        </Button>
      ) : (
        <Button
          variant="default"
          size="compact-sm"
          leftSection={<ScanText size={16} />}
          loading={change.isPending || status.isPending}
          disabled={!data || data.state === "unavailable" || !data.remaining}
          onClick={() => change.mutate("start")}
        >
          Start
        </Button>
      )}
    </SettingRow>
  );
}

/** Settings › Maintenance: clean-up and bug-report tools backed by the gallery and diagnostics routes. */
export function MaintenanceSettings() {
  const client = useQueryClient();
  const admin = useIsAdmin();
  // Read ahead so copying stays inside the tap, which Safari requires for the clipboard.
  const diagnostics = useQuery({
    queryKey: ["diagnostics"],
    queryFn: () => api<{ text: string }>("/api/diagnostics"),
    staleTime: 60_000,
  });
  const clear = useMutation({
    mutationFn: () => post("/api/gallery/errors/clear"),
    onSuccess: () => {
      for (const queryKey of [["gallery"], ["gallery-filters"], ["queue"]])
        void client.invalidateQueries({ queryKey });
      notifications.show({ message: "Failed items cleared" });
    },
  });
  return (
    <Stack gap="lg">
      <SettingGroup title="Clean Up">
        <SettingRow
          label="Clear Failed Items"
          description="Remove your failed and cancelled items from the gallery."
        >
          <Button
            variant="default"
            size="compact-sm"
            leftSection={<Eraser size={16} />}
            loading={clear.isPending}
            onClick={() => clear.mutate()}
          >
            Clear
          </Button>
        </SettingRow>
        <SettingRow
          label="Export Gallery"
          description="Download every finished image and video as one ZIP."
        >
          <Button
            component="a"
            href="/api/gallery/export"
            download
            variant="default"
            size="compact-sm"
            leftSection={<Download size={16} />}
          >
            Export
          </Button>
        </SettingRow>
        {admin && <CaptionGallery />}
      </SettingGroup>
      <SettingGroup title="Help">
        <SettingRow
          label="Copy Diagnostics"
          description="Versions, system and GPU for a bug report; no prompts, images or file names."
        >
          <Button
            variant="default"
            size="compact-sm"
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
            size="compact-sm"
            rightSection={<ExternalLink size={14} />}
          >
            Open
          </Button>
        </SettingRow>
      </SettingGroup>
    </Stack>
  );
}
