import { useState } from "react";
import {
  ActionIcon,
  Alert,
  Button,
  FocusTrap,
  Loader,
  Modal,
  Popover,
  Select,
  Stack,
  Switch,
  Text,
  Tooltip,
} from "@mantine/core";
import { ImageUpscale } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  UpscaleQuality,
  UpscaleRequest,
  UpscaleResponse,
  UpscaleStatus,
} from "../../../../shared/upscale";
import { api, post } from "../../api";
import type { MediaItem } from "../../types";

function UpscaleForm({ item, onQueued }: { item: MediaItem; onQueued: () => void }) {
  const [quality, setQuality] = useState<UpscaleQuality>("balanced");
  const [target, setTarget] = useState("0");
  const [faceDetail, setFaceDetail] = useState(false);
  const cache = useQueryClient();
  const status = useQuery({
    queryKey: ["upscale-status", quality],
    queryFn: () => api<UpscaleStatus>(`/api/upscale/status?quality=${quality}`),
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
      onQueued();
      void Promise.all(
        ["gallery", "queue", "session", "sessions"].map((key) =>
          cache.invalidateQueries({ queryKey: [key] }),
        ),
      );
    },
  });
  const faceAvailable =
    item.type === "image" &&
    status.data?.faceDetail.nodesInstalled &&
    Boolean(status.data.faceDetail.detectors.length);
  return (
    <Stack gap="sm">
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
  );
}
export const upscaling = (item: MediaItem) =>
  ["queued", "running"].includes(item.upscale?.status || "");
/** The viewer's Upscale action and its settings popover; `size` keeps phone touch targets. */
export function UpscaleControls({ item, size }: { item: MediaItem; size?: number }) {
  const [opened, setOpened] = useState(false);
  const busy = upscaling(item);
  return (
    <Popover opened={opened} onChange={setOpened} position="top" width={300} trapFocus>
      <Tooltip label={busy ? "Upscaling…" : "Upscale"} disabled={opened}>
        <Popover.Target>
          <ActionIcon
            variant="default"
            size={size}
            aria-label="Upscale"
            loading={busy}
            onClick={() => setOpened((value) => !value)}
          >
            <ImageUpscale size={18} />
          </ActionIcon>
        </Popover.Target>
      </Tooltip>
      <Popover.Dropdown>
        <Stack gap="sm">
          <Text fw={600}>Upscale</Text>
          <UpscaleForm item={item} onQueued={() => setOpened(false)} />
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
/** The same settings for the Upscale item in tile and Chat result menus. */
export function UpscaleDialog({
  item,
  opened,
  onClose,
}: {
  item: MediaItem;
  opened: boolean;
  onClose: () => void;
}) {
  return (
    <Modal opened={opened} onClose={onClose} title="Upscale" centered size="sm">
      <FocusTrap.InitialFocus />
      <UpscaleForm item={item} onQueued={onClose} />
    </Modal>
  );
}
