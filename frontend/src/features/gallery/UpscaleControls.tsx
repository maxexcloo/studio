import { useState } from "react";
import { Alert, Button, FocusTrap, Modal, Select, Stack, Switch, Text } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  UpscaleQuality,
  UpscaleRequest,
  UpscaleResponse,
  UpscaleStatus,
} from "../../../../shared/upscale";
import { api, post } from "../../api";
import type { MediaItem } from "../../types";
import { DialogFooter } from "../../ui/ConfirmDialog";
import { LoadingState } from "../../ui/LoadingState";
import { useRemembered } from "../auth/useRemembered";

const statusQuery = (quality: UpscaleQuality) => ({
  queryKey: ["upscale-status", quality],
  queryFn: () => api<UpscaleStatus>(`/api/upscale/status?quality=${quality}`),
});

function UpscaleForm({ item, onClose }: { item: MediaItem; onClose: () => void }) {
  const [quality, setQuality] = useState<UpscaleQuality>("balanced");
  const [target, setTarget] = useState("0");
  const [faceDetail, setFaceDetail] = useState(false);
  const cache = useQueryClient();
  const status = useQuery(statusQuery(quality));
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
      onClose();
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
      {status.isPending && <LoadingState fill label="Checking Upscale Worker" />}
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
                  : "Face Detail needs the worker’s face detector and Impact Pack nodes."
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
                ? "This worker has no upscale models."
                : `The worker is missing ${status.data.missingNodes.join(", ")}.`}
            </Alert>
          )}
        </>
      )}
      {upscale.error && <Alert color="red">{upscale.error.message}</Alert>}
      <DialogFooter pending={upscale.isPending} onCancel={onClose}>
        <Button
          loading={upscale.isPending}
          disabled={!status.data?.ready || status.isFetching}
          onClick={() => upscale.mutate()}
        >
          {item.type === "image" ? "Upscale Image" : "Upscale Video"}
        </Button>
      </DialogFooter>
    </Stack>
  );
}
export const upscaling = (item: MediaItem) =>
  ["queued", "running"].includes(item.upscale?.status || "");
/**
 * Upscale's menu runs at the automatic size with its remembered quality (Balanced until chosen) and
 * Face Detail (off until chosen, and only where the worker can run it).
 */
export function useQuickUpscale(item: MediaItem, enabled: boolean) {
  const [quality, setQuality] = useRemembered<UpscaleQuality>("upscale-quality", "balanced");
  const [face, setFace] = useRemembered<boolean>("upscale-face-detail", false);
  const cache = useQueryClient();
  const status = useQuery({
    ...statusQuery("balanced"),
    enabled: enabled && item.type === "image",
  });
  const queue = useMutation({
    mutationFn: ({ quality, faceDetail }: { quality: UpscaleQuality; faceDetail: boolean }) =>
      post<UpscaleResponse>("/api/upscale", {
        galleryItemId: item.id,
        quality,
        target: 0,
        faceDetail,
      } satisfies UpscaleRequest),
    onSuccess: () =>
      void Promise.all(
        ["gallery", "queue", "session", "sessions"].map((key) =>
          cache.invalidateQueries({ queryKey: [key] }),
        ),
      ),
  });
  const detector = status.data?.faceDetail;
  const faceAvailable =
    item.type === "image" && Boolean(detector?.nodesInstalled && detector.detectors.length);
  const faceDetail = face && faceAvailable;
  return {
    queue,
    quality,
    setQuality,
    faceAvailable,
    faceDetail,
    setFaceDetail: setFace,
    run: () => queue.mutate({ quality, faceDetail }),
  };
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
      <UpscaleForm item={item} onClose={onClose} />
    </Modal>
  );
}
