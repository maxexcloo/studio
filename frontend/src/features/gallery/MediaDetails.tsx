import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import {
  ActionIcon,
  Button,
  Menu,
  Popover,
  Tooltip,
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
import { ChevronDown, ChevronUp, Download, Ellipsis, SlidersHorizontal } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import { failure, post } from "../../api";
import type { MediaItem } from "../../types";
import { copyText } from "../../ui/clipboard";
import { useMotionDuration } from "../../ui/Appearance";
import { useMediaAction } from "./useMediaAction";
import { ReferenceMediaAction } from "./ReferenceMediaAction";
import { mediaDownload } from "./download";
import { useMediaFavorite } from "./useMediaFavorite";
import { UpscaleControls } from "./UpscaleControls";
import {
  canCopyMediaImage,
  canShareMedia,
  copyMediaImage,
  prepareMediaShare,
  sharePreparedMedia,
  useShareWithoutSettings,
} from "./mediaShare";
import classes from "./MediaViewer.module.css";
import { usePhone } from "../../ui/usePhone";

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
  onVersionChange,
}: {
  item: MediaItem;
  sessionId?: string;
  compare: boolean;
  onAction: () => void;
  onCompare: () => void;
  onDelete: () => void;
  onVersionChange: (id: string, active: boolean) => void;
}) {
  const phone = usePhone();
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
    if (phone && item.type === "image" && shareSupported && download.href) {
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
  }, [transferKey, item.type, phone, shareSupported]);
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
  const action = useMediaAction(item, sessionId, onAction);
  const favorite = useMediaFavorite(item);
  const cache = useQueryClient();
  const version = useMutation({
    mutationFn: (body: { galleryItemId: string; active: boolean }) =>
      post<{ upscaleActive: boolean }>("/api/upscale/toggle", body),
    onSuccess: (result, body) => {
      onVersionChange(body.galleryItemId, result.upscaleActive);
      void cache.invalidateQueries({ queryKey: ["gallery"] });
      void cache.invalidateQueries({ queryKey: ["session"] });
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
      <Stack gap="xs" className={classes.railContent}>
        <UnstyledButton
          component={phone ? "button" : "div"}
          className={classes.handle}
          aria-label={phone ? "Generation Details" : undefined}
          aria-expanded={phone ? details : undefined}
          aria-controls={phone ? detailsId : undefined}
          onPointerDown={(event: PointerEvent<HTMLElement>) => {
            if (!phone) return;
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
            if (phone && !swipe.current?.moved) setDetails((value) => !value);
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
            {phone && (details ? <ChevronDown size={16} /> : <ChevronUp size={16} />)}
          </Group>
        </UnstyledButton>
        <Collapse
          expanded={!phone || details}
          id={detailsId}
          transitionDuration={motionDuration}
          className={classes.detailsCollapse}
        >
          <Stack className={classes.details} gap="md">
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
        <Group gap={4} className={classes.actions} role="group" aria-label="Generation Actions">
          {item.url && (
            <>
              <Tooltip label="Download">
                <ActionIcon
                  component="a"
                  {...download}
                  aria-label="Download"
                  variant="default"
                  size={36}
                >
                  <Download size={17} />
                </ActionIcon>
              </Tooltip>
              <Button
                size="sm"
                px="sm"
                loading={action.isPending}
                onClick={() => action.mutate(item.type === "video" ? "extend" : "refine")}
              >
                {item.type === "video" ? "Extend" : "Refine"}
              </Button>
              {item.type === "image" && (
                <Button
                  size="sm"
                  px="sm"
                  variant="light"
                  loading={action.isPending}
                  onClick={() => action.mutate("animate")}
                >
                  Animate
                </Button>
              )}
            </>
          )}
          {item.url && item.status === "done" && <UpscaleControls key={item.id} item={item} />}
          <Menu position="top-end" width={220}>
            <Menu.Target>
              <ActionIcon aria-label="More Viewer Actions" variant="default" size={36}>
                <Ellipsis size={18} />
              </ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              {item.url && item.type === "image" && canCopyMediaImage() && (
                <Menu.Item h={36} disabled={copying} onClick={() => void copyImage()}>
                  Copy Image
                </Menu.Item>
              )}
              {item.url && phone && shareSupported && (
                <Menu.Item h={36} disabled={preparingShare || sharing} onClick={() => void share()}>
                  {shareFile ? "Share" : "Prepare Share"}
                </Menu.Item>
              )}
              <Menu.Item h={36} onClick={() => void copyText(item.prompt || "", "Prompt")}>
                Copy Prompt
              </Menu.Item>
              <ReferenceMediaAction item={item} onApplied={onAction} />
              <Menu.Item h={36} disabled={action.isPending} onClick={() => action.mutate("image")}>
                Recreate
              </Menu.Item>
              <Menu.Item h={36} disabled={favorite.isPending} onClick={() => favorite.mutate()}>
                {item.favorite ? "Unstar" : "Star"}
              </Menu.Item>
              {item.type === "image" && item.upscale?.url && !item.upscale.withRun && (
                <Menu.Item h={36} onClick={onCompare}>
                  {compare ? "Close Comparison" : "Compare"}
                </Menu.Item>
              )}
              <Menu.Divider />
              <Menu.Item h={36} color="red" onClick={onDelete}>
                Delete
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
          <Popover position="top-end" width={280} trapFocus>
            <Popover.Target>
              <ActionIcon aria-label="Viewer Options" variant="default" size={36}>
                <SlidersHorizontal size={17} />
              </ActionIcon>
            </Popover.Target>
            <Popover.Dropdown>
              <Stack gap="md">
                {item.upscale?.url && !item.upscale.withRun && (
                  <Switch
                    label="Show Upscale"
                    checked={Boolean(item.upscaleActive)}
                    disabled={version.isPending}
                    onChange={(event) =>
                      version.mutate({
                        galleryItemId: item.id,
                        active: event.currentTarget.checked,
                      })
                    }
                  />
                )}
                <Switch
                  label="Share Without Settings"
                  description="Leave the prompt, seed and workflow out of downloaded or shared files."
                  checked={withoutSettings}
                  onChange={(event) => setWithoutSettings(event.currentTarget.checked)}
                />
              </Stack>
            </Popover.Dropdown>
          </Popover>
        </Group>
      </Stack>
    </Paper>
  );
}
