import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import {
  Button,
  Collapse,
  Group,
  Paper,
  Stack,
  Switch,
  Table,
  Text,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { useMediaQuery } from "@mantine/hooks";
import { ChevronDown, ChevronUp } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { api, failure } from "../../api";
import type { MediaItem } from "../../types";
import { copyText } from "../../ui/clipboard";
import { useMotionDuration } from "../../ui/Appearance";
import { useMediaAction } from "./useMediaAction";
import { mediaDownload } from "./download";
import {
  canCopyMediaImage,
  canShareMedia,
  copyMediaImage,
  prepareMediaShare,
  sharePreparedMedia,
  useShareWithoutSettings,
} from "./mediaShare";
import classes from "./MediaViewer.module.css";

function generationTitle(prompt = "") {
  const plain = prompt
    .replace(/<[^>]*>/g, " ")
    .replace(/[()[\]{}]/g, "")
    .replace(/:\s*-?\d+(\.\d+)?/g, "")
    .trim();
  const line = plain.split(/[,.;|\n]/)[0].trim() || plain;
  const text = line.length > 64 ? `${line.slice(0, 61).replace(/\s+\S*$/, "")}…` : line;
  return text ? text[0].toUpperCase() + text.slice(1) : "Untitled Generation";
}

export function MediaDetails({
  item,
  sessionId,
  compare,
  onAction,
  onCompare,
  onDelete,
}: {
  item: MediaItem;
  sessionId?: string;
  compare: boolean;
  onAction: () => void;
  onCompare: () => void;
  onDelete: () => void;
}) {
  const narrow = useMediaQuery("(max-width: 48em)", false, { getInitialValueInEffect: false });
  const motionDuration = useMotionDuration();
  const [withoutSettings, setWithoutSettings] = useShareWithoutSettings();
  const download = mediaDownload(item, withoutSettings);
  const transferKey = `${download.href}
${download.download}`;
  const [preparedShare, setPreparedShare] = useState<{ key: string; file: File } | null>(null);
  const shareFile = preparedShare?.key === transferKey ? preparedShare.file : null;
  const preparation = useRef<AbortController | null>(null);
  const [preparingShare, setPreparingShare] = useState(false);
  const [copying, setCopying] = useState(false);
  const [sharing, setSharing] = useState(false);
  const shareSupported = canShareMedia(item.type);
  useEffect(() => {
    preparation.current?.abort();
    const controller = new AbortController();
    preparation.current = controller;
    setPreparedShare(null);
    setPreparingShare(false);
    if (narrow && item.type === "image" && shareSupported && download.href) {
      setPreparingShare(true);
      void prepareMediaShare(download, controller.signal)
        .then((file) => {
          if (!controller.signal.aborted) setPreparedShare({ key: transferKey, file });
        })
        .catch(() => {})
        .finally(() => {
          if (!controller.signal.aborted) setPreparingShare(false);
        });
    }
    return () => preparation.current?.abort();
  }, [transferKey, item.type, narrow, shareSupported]);
  async function share() {
    if (!shareFile) {
      setPreparingShare(true);
      const controller = preparation.current || new AbortController();
      preparation.current = controller;
      try {
        const file = await prepareMediaShare(download, controller.signal);
        if (!controller.signal.aborted) setPreparedShare({ key: transferKey, file });
      } catch (error) {
        if (!controller.signal.aborted) failure(error);
      } finally {
        if (!controller.signal.aborted) setPreparingShare(false);
      }
      return;
    }
    setSharing(true);
    try {
      const result = await sharePreparedMedia(shareFile, download);
      if (result === "downloaded")
        notifications.show({ message: "Sharing is unavailable. Download started." });
    } catch (error) {
      failure(error);
    } finally {
      setSharing(false);
    }
  }
  async function copyImage() {
    setCopying(true);
    try {
      const result = await copyMediaImage(download, withoutSettings);
      notifications.show({
        message: result === "copied" ? "Image copied" : "Clipboard unavailable. Download started.",
      });
    } catch (error) {
      failure(error);
    } finally {
      setCopying(false);
    }
  }

  const [details, setDetails] = useState(false);
  const detailsId = useId();
  const swipe = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const client = useQueryClient();
  const action = useMediaAction(item, sessionId, onAction);
  const mutate = useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown }) =>
      api(path, { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["gallery"] });
      void client.invalidateQueries({ queryKey: ["session"] });
    },
    onError: failure,
  });
  return (
    <Paper
      withBorder
      radius="lg"
      p="sm"
      className={classes.rail}
      onClick={(event) => event.stopPropagation()}
    >
      <Stack gap="xs">
        <UnstyledButton
          component={narrow ? "button" : "div"}
          className={classes.handle}
          aria-label={narrow ? "Generation Details" : undefined}
          aria-expanded={narrow ? details : undefined}
          aria-controls={narrow ? detailsId : undefined}
          onPointerDown={(event: PointerEvent<HTMLElement>) => {
            if (!narrow) return;
            swipe.current = { x: event.clientX, y: event.clientY, moved: false };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerUp={(event: PointerEvent<HTMLElement>) => {
            const start = swipe.current;
            if (!start) return;
            const dy = event.clientY - start.y;
            if (Math.abs(dy) > 40 && Math.abs(dy) > Math.abs(event.clientX - start.x)) {
              setDetails(dy < 0);
              start.moved = true;
            }
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => {
            swipe.current = null;
          }}
          onClick={() => {
            if (narrow && !swipe.current?.moved) setDetails((value) => !value);
            swipe.current = null;
          }}
        >
          <div className={classes.handleLine} />
          <Group justify="space-between" wrap="nowrap">
            <Stack gap={2} style={{ minWidth: 0 }}>
              <Text fw={600} size="sm" lineClamp={1}>
                {generationTitle(item.prompt)}
              </Text>
              <Text size="xs" c="dimmed" lineClamp={1}>
                {item.type === "video" ? "Video" : "Image"}
                {item.width ? ` · ${item.width} × ${item.height}` : ""}
                {item.model ? ` · ${item.model}` : ""}
              </Text>
            </Stack>
            {narrow && (details ? <ChevronDown size={16} /> : <ChevronUp size={16} />)}
          </Group>
        </UnstyledButton>
        {item.url && (
          <Group gap="xs">
            <Button component="a" {...download} variant="default" size="compact-sm">
              Download
            </Button>
            <Button
              size="compact-sm"
              loading={action.isPending}
              onClick={() => action.mutate(item.type === "video" ? "extend" : "refine")}
            >
              {item.type === "video" ? "Extend" : "Refine"}
            </Button>
            {item.type === "image" && (
              <Button
                size="compact-sm"
                variant="light"
                loading={action.isPending}
                onClick={() => action.mutate("animate")}
              >
                Animate
              </Button>
            )}
          </Group>
        )}
        <Collapse expanded={!narrow || details} id={detailsId} transitionDuration={motionDuration}>
          <Stack className={classes.details} gap="md">
            <Switch
              label="Share Without Settings"
              description="Leave the prompt, seed and workflow out of downloaded or shared files."
              checked={withoutSettings}
              onChange={(event) => setWithoutSettings(event.currentTarget.checked)}
            />
            <Group gap="xs">
              {item.url && item.type === "image" && canCopyMediaImage() && (
                <Button
                  variant="default"
                  size="compact-sm"
                  loading={copying}
                  onClick={() => void copyImage()}
                >
                  Copy Image
                </Button>
              )}
              {item.url && narrow && shareSupported && (
                <Button
                  variant="default"
                  size="compact-sm"
                  loading={preparingShare || sharing}
                  onClick={() => void share()}
                >
                  {shareFile ? "Share" : "Prepare Share"}
                </Button>
              )}

              <Button
                variant="default"
                size="compact-sm"
                onClick={() => {
                  void copyText(item.prompt || "")
                    .then(() => notifications.show({ message: "Prompt copied" }))
                    .catch(failure);
                }}
              >
                Copy Prompt
              </Button>
              <Button
                variant="default"
                size="compact-sm"
                loading={action.isPending}
                onClick={() => action.mutate("image")}
              >
                Recreate
              </Button>
              <Button
                variant="subtle"
                size="compact-sm"
                onClick={() =>
                  mutate.mutate({
                    path: "/api/gallery/favorite",
                    body: { ids: [item.id], favorite: !item.favorite },
                  })
                }
              >
                {item.favorite ? "Unstar" : "Star"}
              </Button>
              {item.url && item.type === "image" && (
                <Button
                  variant="subtle"
                  size="compact-sm"
                  onClick={() =>
                    mutate.mutate({
                      path: "/api/upscale",
                      body: { galleryItemId: item.id, quality: "balanced" },
                    })
                  }
                >
                  Upscale
                </Button>
              )}
              {item.upscale?.url && (
                <Button
                  variant="subtle"
                  size="compact-sm"
                  onClick={() => {
                    onCompare();
                  }}
                >
                  {compare ? "Close Comparison" : "Compare"}
                </Button>
              )}
              <Button color="red" variant="subtle" size="compact-sm" onClick={onDelete}>
                Delete
              </Button>
            </Group>

            <Stack gap="sm">
              <Title order={5}>Prompt</Title>
              <Text style={{ whiteSpace: "pre-wrap" }}>{item.prompt}</Text>
              {item.negative && (
                <>
                  <Title order={5}>Negative Prompt</Title>
                  <Text>{item.negative}</Text>
                </>
              )}
              <Title order={5}>Model & Settings</Title>
              <Text size="sm">{item.model}</Text>
              <Table.ScrollContainer minWidth={360}>
                <Table aria-label="Generation Settings" verticalSpacing="xs">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Setting</Table.Th>
                      <Table.Th>Value</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {Object.entries(item.settings || {})
                      .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
                      .sort(([a], [b]) => a.localeCompare(b))
                      .map(([key, value]) => (
                        <Table.Tr key={key}>
                          <Table.Td>
                            <Text size="sm" c="dimmed">
                              {key}
                            </Text>
                          </Table.Td>
                          <Table.Td>
                            <Text size="sm" style={{ overflowWrap: "anywhere" }}>
                              {String(value)}
                            </Text>
                          </Table.Td>
                        </Table.Tr>
                      ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
              <Text size="xs" c="dimmed">
                {item.createdAt}
              </Text>
            </Stack>
          </Stack>
        </Collapse>
      </Stack>
    </Paper>
  );
}
