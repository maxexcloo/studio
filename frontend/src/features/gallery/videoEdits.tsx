import { useRef, useState } from "react";
import { Alert, Button, Group, Modal, RangeSlider, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { post } from "../../api";
import type { MediaItem } from "../../types";
import { usePhone } from "../../ui/usePhone";
import { queueQuery } from "../generation/Queue";
import { playbackUrl } from "./mediaSource";

/** A video edit backend/gallery/video-edits.js saves as a new version of the clip. */
export type VideoEdit =
  | { kind: "trim"; start: number; end: number }
  | { kind: "reverse" | "loop" | "smooth" | "slow" };

/** Edit › a video edit; the original stays and the edited clip joins its versions. */
export function useVideoEdit(item: MediaItem, { inlineError = false } = {}) {
  const cache = useQueryClient();
  return useMutation({
    meta: { inlineError },
    mutationFn: (edit: VideoEdit) =>
      post<{ id: string }>("/api/gallery/video-edit", { galleryItemId: item.id, ...edit }),
    onSuccess: () => {
      void cache.invalidateQueries({ queryKey: ["gallery"] });
      void cache.invalidateQueries({ queryKey: queueQuery.queryKey });
    },
  });
}

const time = (ms: number) => `${(ms / 1000).toFixed(2)} s`;

/** Edit › Trim…: the part of the clip to keep, previewed as each end moves. */
export function TrimVideoDialog({ item, onClose }: { item: MediaItem; onClose: () => void }) {
  const phone = usePhone();
  const player = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState(0);
  const [range, setRange] = useState<[number, number]>([0, 0]);
  const save = useVideoEdit(item, { inlineError: true });
  return (
    <Modal opened onClose={onClose} title="Trim Video" centered size="lg" fullScreen={phone}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          // The dialog closes, leaving nowhere in place to say so.
          save.mutate(
            { kind: "trim", start: range[0], end: range[1] },
            {
              onSuccess: () => {
                notifications.show({ message: "Saved as a new version." });
                onClose();
              },
            },
          );
        }}
      >
        <Stack>
          <video
            ref={player}
            src={playbackUrl(item.url)}
            controls
            muted
            playsInline
            preload="metadata"
            style={{ width: "100%", maxHeight: "50vh", borderRadius: "var(--mantine-radius-md)" }}
            onLoadedMetadata={(event) => {
              const video = event.currentTarget;
              // A WebM without a stored length reads as Infinity until the browser seeks to its end.
              if (video.duration === Infinity) video.currentTime = Number.MAX_SAFE_INTEGER;
            }}
            onDurationChange={(event) => {
              const video = event.currentTarget;
              if (!Number.isFinite(video.duration) || duration) return;
              const ms = Math.round(video.duration * 1000);
              setDuration(ms);
              setRange([0, ms]);
              video.currentTime = 0;
            }}
          />
          <RangeSlider
            min={0}
            max={duration || 1}
            step={10}
            minRange={100}
            value={range}
            disabled={!duration}
            label={time}
            thumbFromLabel="Start"
            thumbToLabel="End"
            onChange={(next) => {
              // The player shows the end that moved.
              const moved = next[0] !== range[0] ? next[0] : next[1];
              if (player.current) player.current.currentTime = moved / 1000;
              setRange(next);
            }}
          />
          <Text size="sm" c="dimmed">
            Keeps {time(range[0])} to {time(range[1])}, {time(range[1] - range[0])} of{" "}
            {time(duration)}.
          </Text>
          {save.error && <Alert color="red">{save.error.message}</Alert>}
          <Group justify="flex-end">
            <Button type="submit" loading={save.isPending} disabled={!duration}>
              Save Version
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
