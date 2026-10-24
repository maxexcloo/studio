import { useState } from "react";
import { Alert, Button, Loader, Popover, Select, Stack, Switch, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  UpscaleQuality,
  UpscaleRequest,
  UpscaleResponse,
  UpscaleStatus,
} from "../../../../shared/upscale";
import { api, post } from "../../api";
import type { MediaItem } from "../../types";

export function UpscaleControls({ item }: { item: MediaItem }) {
  const [opened, setOpened] = useState(false);
  const [quality, setQuality] = useState<UpscaleQuality>("balanced");
  const [target, setTarget] = useState("0");
  const [faceDetail, setFaceDetail] = useState(false);
  const cache = useQueryClient();
  const status = useQuery({
    queryKey: ["upscale-status", quality],
    queryFn: () => api<UpscaleStatus>(`/api/upscale/status?quality=${quality}`),
    enabled: opened,
  });
  const upscale = useMutation({
    meta: { inlineError: true },
    mutationFn: () =>
      post<UpscaleResponse>("/api/upscale", {
        galleryItemId: item.id,
        quality,
        target: Number(target) as UpscaleRequest["target"],
        faceDetail: faceDetail && Boolean(faceAvailable),
      } satisfies UpscaleRequest),
    onSuccess: () => {
      setOpened(false);
      notifications.show({ message: "Upscale queued" });
      void Promise.all(
        ["gallery", "queue", "session", "sessions"].map((key) =>
          cache.invalidateQueries({ queryKey: [key] }),
        ),
      );
    },
  });
  const busy = ["queued", "running"].includes(item.upscale?.status || "");
  const faceAvailable =
    item.type === "image" &&
    status.data?.faceDetail.nodesInstalled &&
    Boolean(status.data.faceDetail.detectors.length);
  return (
    <Popover opened={opened} onChange={setOpened} position="top-start" width={300} trapFocus>
      <Popover.Target>
        <Button
          variant="subtle"
          size="sm"
          px="sm"
          disabled={busy}
          onClick={() => setOpened((value) => !value)}
        >
          {busy ? "Upscaling…" : "Upscale"}
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="sm">
          <Text fw={600}>Upscale</Text>
          {status.isPending ? <Loader size="sm" aria-label="Checking Upscale Worker" /> : null}
          {status.error && (
            <Alert color="red" title="Upscale Unavailable">
              {status.error.message}
              <Button variant="subtle" size="compact-sm" onClick={() => void status.refetch()}>
                Retry
              </Button>
            </Alert>
          )}
          {status.data && (
            <>
              <Select
                label="Upscale Quality"
                comboboxProps={{ withinPortal: false }}
                value={quality}
                data={status.data.qualities.map((value) => ({
                  value,
                  label: value[0].toUpperCase() + value.slice(1),
                }))}
                allowDeselect={false}
                disabled={upscale.isPending}
                onChange={(value) => {
                  if (value) setQuality(value as UpscaleQuality);
                }}
              />
              <Select
                label="Upscale Size"
                comboboxProps={{ withinPortal: false }}
                description="Keeps the aspect ratio and never reduces the source."
                value={target}
                data={[
                  { value: "0", label: "Automatic" },
                  ...status.data.targets.map((value) => ({
                    value: String(value),
                    label: `${value / 1024}K · ${value}px Long Edge`,
                  })),
                ]}
                allowDeselect={false}
                disabled={upscale.isPending}
                onChange={(value) => {
                  if (value) setTarget(value);
                }}
              />
              {item.type === "image" && (
                <Switch
                  label="Face Detail"
                  description={
                    faceAvailable
                      ? "Refine faces using this image’s original model."
                      : "Face detail requires the worker’s face detector and Impact Pack nodes."
                  }
                  checked={faceDetail && Boolean(faceAvailable)}
                  disabled={!faceAvailable || upscale.isPending}
                  onChange={(event) => setFaceDetail(event.currentTarget.checked)}
                />
              )}
              {status.data.substituting && (
                <Text size="xs" c="dimmed">
                  Uses installed model {status.data.fallbackFile}.
                </Text>
              )}
              {!status.data.ready && (
                <Alert color="yellow">
                  {status.data.nodesInstalled
                    ? "The upscale models are unavailable on this worker."
                    : `The worker is missing ${status.data.missingNodes.join(", ")}.`}
                </Alert>
              )}
            </>
          )}
          {upscale.error && <Alert color="red">{upscale.error.message}</Alert>}
          <Button
            loading={upscale.isPending}
            disabled={!status.data?.ready || status.isFetching}
            onClick={() => upscale.mutate()}
          >
            Queue Upscale
          </Button>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
