import { notifications } from "@mantine/notifications";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  UpscaleQuality,
  UpscaleRequest,
  UpscaleResponse,
  UpscaleStatus,
} from "../../../../shared/upscale";
import { api, failure, post } from "../../api";
import type { MediaItem } from "../../types";
import { Eye, ScanFace } from "lucide-react";
import { icons } from "../../ui/icons";
import { usePhone } from "../../ui/usePhone";
import { useIsAdmin } from "../auth/AccountGate";
import { useRemembered } from "../auth/useRemembered";
import type { Action } from "./ActionBar";
import { itemAction } from "./itemActions";
import { useItemMutation } from "./useItemMutation";

const statusQuery = (quality: UpscaleQuality) => ({
  queryKey: ["upscale-status", quality],
  queryFn: () => api<UpscaleStatus>(`/api/upscale/status?quality=${quality}`),
});

export const upscaling = (item: MediaItem) =>
  ["queued", "running"].includes(item.upscale?.status || "");
/**
 * Stop for an upscale queued or running on a finished item: it cancels the upscale's queue job, and
 * the item keeps its original, marked Upscale Cancelled in Details.
 */
export function useStopUpscale(item: MediaItem) {
  const cache = useQueryClient();
  const cancel = useItemMutation(item.id, "stop-upscale", {
    mutationFn: (jobId: string) => post(`/api/queue/${encodeURIComponent(jobId)}/cancel`),
    onSuccess: () =>
      void Promise.all(
        ["queue", "session", "gallery"].map((key) => cache.invalidateQueries({ queryKey: [key] })),
      ),
  });
  const jobId = upscaling(item) ? item.upscale?.jobId : undefined;
  return jobId ? { isPending: cancel.isPending, stop: () => cancel.mutate(jobId) } : null;
}
type UpscaleTarget = NonNullable<UpscaleRequest["target"]>;
/**
 * Upscale's menu runs with its remembered settings: quality (Balanced until chosen), size (Automatic
 * until chosen, and only a size the worker offers) and Face Detail (off until chosen, and only where
 * the worker can run it). `status` says whether the worker can run it at that quality.
 */
export function useQuickUpscale(item: MediaItem, enabled: boolean) {
  const [quality, setQuality] = useRemembered<UpscaleQuality>("upscale-quality", "balanced");
  const [size, setSize] = useRemembered<UpscaleTarget>("upscale-size", 0);
  const [face, setFace] = useRemembered<boolean>("upscale-face-detail", false);
  const cache = useQueryClient();
  // The menu keeps its settings in place while another quality's status loads.
  const status = useQuery({ ...statusQuery(quality), enabled, placeholderData: keepPreviousData });
  const target = status.data?.targets.includes(size as Exclude<UpscaleTarget, 0>) ? size : 0;
  const queue = useItemMutation(item.id, "upscale", {
    mutationFn: (request: Omit<UpscaleRequest, "galleryItemId">) =>
      post<UpscaleResponse>("/api/upscale", {
        galleryItemId: item.id,
        ...request,
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
  // What the worker lacks for Face Detail, once its status says.
  const faceMissing =
    detector && !faceAvailable
      ? detector.nodesInstalled
        ? "Needs the face detector"
        : "Needs Impact Pack"
      : undefined;
  // An administrator can fetch the catalogue's face detector from here; Library › Downloads shows it.
  const admin = useIsAdmin();
  const faceDownload = useMutation({
    mutationFn: (id: string) => post("/api/models/downloads", { id }),
    onSuccess: () => {
      notifications.show({
        message: "Downloading the face detector in Library › Downloads.",
      });
      void cache.invalidateQueries({ queryKey: ["library-downloads"] });
    },
    onError: failure,
  });
  const download = admin && detector?.nodesInstalled ? detector.download : undefined;
  const downloadFaceDetector = download && {
    label: download.label,
    pending: faceDownload.isPending,
    run: () => faceDownload.mutate(download.id),
  };
  return {
    queue,
    status,
    quality,
    setQuality,
    target,
    setTarget: setSize,
    faceAvailable,
    faceMissing,
    downloadFaceDetector,
    faceDetail,
    setFaceDetail: setFace,
    run: () => queue.mutate({ quality, target, faceDetail }),
  };
}
/**
 * Upscale for a selection: each image runs with Upscale's remembered settings, as its own menu
 * would run it, read for the first.
 */
export function useUpscaleMany(items: MediaItem[]) {
  const settings = useQuickUpscale(
    items[0] ?? ({ id: "", type: "image" } as MediaItem),
    items.length > 0,
  );
  const cache = useQueryClient();
  return useMutation({
    // Each item on its own, so one that fails leaves the rest queued; it reports the ones that failed.
    mutationFn: async () => {
      const outcomes = await Promise.allSettled(
        items.map((item) =>
          post<UpscaleResponse>("/api/upscale", {
            galleryItemId: item.id,
            quality: settings.quality,
            target: settings.target,
            faceDetail: settings.faceDetail,
          } satisfies UpscaleRequest),
        ),
      );
      const failed = items.filter((_item, index) => outcomes[index].status === "rejected");
      const rejected = outcomes.find((outcome) => outcome.status === "rejected");
      return { failed: failed.map((item) => item.id), error: rejected?.reason as unknown };
    },
    onSettled: () =>
      void Promise.all(
        ["gallery", "queue", "session", "sessions"].map((key) =>
          cache.invalidateQueries({ queryKey: [key] }),
        ),
      ),
  });
}
/**
 * The media actions' Upscale: Show Upscale and Compare Upscale once there is one, its remembered
 * settings, then the run (MediaActions.tsx places it). Why the worker can't run it shows above them.
 */
export function useUpscaleAction(
  item: MediaItem,
  {
    ready,
    compare,
    onCompare,
    onVersionChange,
  }: {
    ready: boolean;
    compare?: boolean;
    onCompare?: () => void;
    onVersionChange?: (id: string, active: boolean) => void;
  },
): Action | false {
  const image = ready && item.type === "image";
  // Phones compare an upscale above its original.
  const phone = usePhone();
  const cache = useQueryClient();
  const version = useItemMutation(item.id, "upscale-version", {
    mutationFn: (active: boolean) =>
      post<{ upscaleActive: boolean }>("/api/upscale/toggle", { galleryItemId: item.id, active }),
    onSuccess: (result) => {
      onVersionChange?.(item.id, result.upscaleActive);
      void cache.invalidateQueries({ queryKey: ["gallery"] });
      void cache.invalidateQueries({ queryKey: ["session"] });
    },
  });
  const upscaled = Boolean(item.upscale?.url && !item.upscale.withRun);
  const quick = useQuickUpscale(item, ready);
  const upscaleBusy = upscaling(item) || quick.queue.isPending;
  const { data: status, error } = quick.status;
  const unavailable =
    error?.message ??
    (status && !status.ready
      ? status.nodesInstalled
        ? "This worker has no upscale models."
        : `The worker is missing ${status.missingNodes.join(", ")}.`
      : undefined);
  return (
    ready &&
    itemAction("upscale", {
      // Laid out like Animate: with an upscale, switching between it and the original comes
      // first; then the remembered settings, then the runs. The usual click is the first run
      // option: Show Upscale, else Upscale at the chosen settings.
      label: upscaling(item) ? "Upscaling…" : "Upscale",
      pressed: upscaled && Boolean(item.upscaleActive),
      loading: upscaleBusy && !upscaled,
      disabled: upscaled ? version.isPending : upscaleBusy,
      note: unavailable,
      menu: [
        upscaled
          ? [
              {
                id: "show-upscale",
                label: "Show Upscale",
                icon: Eye,
                checked: Boolean(item.upscaleActive),
                disabled: version.isPending,
                onClick: () => version.mutate(!item.upscaleActive),
              },
              ...(onCompare && image
                ? [
                    {
                      id: "compare-upscale",
                      label: "Compare Upscale",
                      icon: phone ? icons.compareStacked : icons.compareSideBySide,
                      checked: Boolean(compare),
                      onClick: onCompare,
                    },
                  ]
                : []),
            ]
          : [],
        [
          {
            id: "upscale-quality",
            label: "Upscale Quality",
            icon: icons.upscale,
            choice: {
              value: quick.quality,
              options: (status?.qualities ?? (["fast", "balanced", "high"] as const)).map(
                (value) => ({ value, label: value[0].toUpperCase() + value.slice(1) }),
              ),
              onChange: (value: string) => quick.setQuality(value as typeof quick.quality),
            },
          },
          ...(status?.targets.length
            ? [
                {
                  id: "upscale-size",
                  label: "Upscale Size",
                  icon: icons.upscale,
                  choice: {
                    value: String(quick.target),
                    options: [
                      { value: "0", label: "Auto" },
                      ...status.targets.map((value) => ({
                        value: String(value),
                        label: `${value / 1024}K`,
                      })),
                    ],
                    onChange: (value: string) =>
                      quick.setTarget(Number(value) as typeof quick.target),
                  },
                },
              ]
            : []),
          // Face Detail joins every run from here once checked; disabled where the worker can't.
          ...(image
            ? [
                {
                  id: "upscale-face",
                  label: "Face Detail",
                  description: quick.faceMissing,
                  icon: ScanFace,
                  checked: quick.faceDetail,
                  disabled: !quick.faceAvailable,
                  keepOpen: true,
                  onClick: () => quick.setFaceDetail(!quick.faceDetail),
                },
                ...(quick.downloadFaceDetector
                  ? [
                      {
                        id: "upscale-face-download",
                        label: "Download Face Detector",
                        description: quick.downloadFaceDetector.label,
                        icon: icons.download,
                        disabled: quick.downloadFaceDetector.pending,
                        onClick: quick.downloadFaceDetector.run,
                      },
                    ]
                  : []),
              ]
            : []),
        ],
        [
          error
            ? {
                id: "upscale-check",
                label: "Check Again",
                icon: icons.refresh,
                disabled: quick.status.isFetching,
                keepOpen: true,
                onClick: () => void quick.status.refetch(),
              }
            : {
                id: upscaled ? "upscale-again" : "upscale-run",
                label: upscaled ? "Regenerate Upscale" : image ? "Upscale Image" : "Upscale Video",
                description: status?.substituting
                  ? `Uses installed model ${status.fallbackFile}`
                  : undefined,
                icon: upscaled ? icons.retry : icons.upscale,
                disabled: upscaleBusy || (status && !status.ready),
                onClick: quick.run,
              },
        ],
      ],
    })
  );
}
