import { useId, useRef, useState, type PointerEvent } from "react";
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
import { post } from "../../api";
import type { MediaItem } from "../../types";
import { useMotionDuration } from "../../ui/Appearance";
import { useMediaAction } from "./useMediaAction";
import { MediaActionItems } from "./MediaActions";
import { UpscaleControls } from "./UpscaleControls";
import { useMediaTransfer, useShareWithoutSettings } from "./mediaShare";
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
  const transfer = useMediaTransfer(item, true);
  const [details, setDetails] = useState(false);
  const detailsId = useId();
  const swipe = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const action = useMediaAction(item, sessionId, onAction);
  const cache = useQueryClient();
  const version = useMutation({
    mutationFn: (body: { galleryItemId: string; active: boolean }) =>
      post<{ upscaleActive: boolean }>("/api/upscale/toggle", body),
    onSuccess: (result, body) => {
      onVersionChange(body.galleryItemId, result.upscaleActive);
      void cache.invalidateQueries({ queryKey: ["gallery"] });
      void cache.invalidateQueries({ queryKey: ["session"] });
    },
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
                  {...transfer.download}
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
              <MediaActionItems
                item={item}
                transfer={transfer}
                sessionId={sessionId}
                omit={["refine", "animate", "upscale", "download"]}
                compare={compare}
                onApplied={onAction}
                onCompare={onCompare}
                onDelete={onDelete}
              />
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
