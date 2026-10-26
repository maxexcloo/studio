import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ActionIcon, Anchor, Group, Paper, Stack, Text, Tooltip } from "@mantine/core";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { MessageCircle, X } from "lucide-react";
import { Link } from "react-router";
import type { MediaItem } from "../../types";
import { useMotionDuration } from "../../ui/Appearance";
import { focusTile, type GalleryViewProps } from "./MediaGrid";
import { mediaSource } from "./mediaSource";
import { mediaTitle } from "./mediaLabels";
import { MediaTile } from "./MediaTile";
import { galleryGap, useGalleryLayout, useHoldToSelect } from "./useGalleryLayout";
import classes from "./RunsView.module.css";

interface Run {
  key: string;
  items: MediaItem[];
}
type Row = { key: string; runs: Run[] } | { key: string; panel: Run };

/** Consecutive items from one job form a run; items without a job stand alone. */
function groupRuns(items: MediaItem[]) {
  const runs: Run[] = [];
  for (const item of items) {
    const last = runs[runs.length - 1];
    if (item.jobId && last?.items[0].jobId === item.jobId) last.items.push(item);
    else runs.push({ key: item.jobId ? `${item.jobId}:${item.id}` : item.id, items: [item] });
  }
  return runs;
}
const countLabel = (run: Run) =>
  `${run.items.length} ${run.items[0].type === "video" ? "Videos" : "Images"}`;

/**
 * Each run is a stacked card; a run of several fans its items out in place, in a panel below the
 * stack's row, and folds them back on close. Single results open the viewer directly.
 */
export function RunsView({
  items,
  open,
  selection,
  focusItem,
  caption,
  detail,
  chatTitle,
  renderActions,
  onSelectionMenu,
  onTryAgain,
}: GalleryViewProps) {
  const { columns, host, width, cell } = useGalleryLayout();
  const motionDuration = useMotionDuration();
  const hold = useHoldToSelect(items, selection);
  const runs = useMemo(() => groupRuns(items), [items]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [menuItem, setMenuItem] = useState<string | null>(null);
  const fanning = useRef<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<string | null>(null);
  const rows = useMemo(() => {
    const rows: Row[] = [];
    for (let index = 0; index < runs.length; index += columns) {
      const chunk = runs.slice(index, index + columns);
      rows.push({ key: chunk[0].key, runs: chunk });
      const open = chunk.find((run) => run.key === expanded && run.items.length > 1);
      if (open) rows.push({ key: `panel:${open.key}`, panel: open });
    }
    return rows;
  }, [runs, columns, expanded]);
  const virtual = useWindowVirtualizer({
    count: width ? rows.length : 0,
    gap: galleryGap * 2,
    estimateSize: (index) => {
      const row = rows[index];
      return "panel" in row
        ? 56 + Math.ceil(row.panel.items.length / columns) * (cell + galleryGap)
        : cell + 56;
    },
    getItemKey: (index) => rows[index].key,
    overscan: 2,
    scrollMargin: host.current?.offsetTop || 0,
  });
  useLayoutEffect(() => virtual.measure(), [width, columns, virtual]);
  useLayoutEffect(() => {
    if (pendingFocus.current && focusTile(host.current, pendingFocus.current))
      pendingFocus.current = null;
  });
  useLayoutEffect(() => {
    if (!focusItem || !width) return;
    const index = rows.findIndex((row) =>
      "panel" in row
        ? row.panel.items.some((item) => item.id === focusItem)
        : row.runs.some((run) => run.items.some((item) => item.id === focusItem)),
    );
    if (index < 0) return;
    pendingFocus.current = focusItem;
    virtual.scrollToIndex(index, { align: "auto" });
    if (focusTile(host.current, focusItem)) pendingFocus.current = null;
  }, [focusItem, width, virtual]);

  /** The panel's tiles fly from (or back to) the stack at its run's place as the panel fades. */
  function fan(key: string, out: boolean) {
    const origin = host.current
      ?.querySelector(`[data-run="${CSS.escape(key)}"]`)
      ?.getBoundingClientRect();
    if (!origin || !panel.current || !motionDuration) return Promise.resolve();
    const timing = {
      duration: motionDuration * 2,
      easing: "cubic-bezier(.2, .8, .2, 1)",
      fill: out ? "backwards" : "forwards",
    } as const;
    const shown = [{ opacity: 0 }, { opacity: 1 }];
    const animations = [panel.current.animate(out ? shown : shown.reverse(), timing)];
    const tiles = panel.current.querySelectorAll<HTMLElement>(`.${classes.fanned}`);
    tiles.forEach((tile, index) => {
      const rect = tile.getBoundingClientRect();
      const stacked = {
        transform: `translate(${origin.left - rect.left}px, ${origin.top - rect.top}px) scale(${origin.width / rect.width}) rotate(${index % 2 ? 2 : -2}deg)`,
        opacity: 0,
      };
      const placed = { transform: "none", opacity: 1 };
      animations.push(
        tile.animate(out ? [stacked, placed] : [placed, stacked], {
          ...timing,
          delay: (out ? index : tiles.length - 1 - index) * 25,
        }),
      );
    });
    return Promise.all(animations.map((animation) => animation.finished)).then(() => undefined);
  }
  useLayoutEffect(() => {
    if (!expanded || fanning.current !== expanded) return;
    fanning.current = null;
    void fan(expanded, true);
  });
  async function toggle(run: Run) {
    if (expanded === run.key) {
      await fan(run.key, false);
      setExpanded(null);
    } else {
      fanning.current = run.key;
      setExpanded(run.key);
    }
  }
  function collapse(run: Run) {
    void toggle(run).then(() => focusTile(host.current, run.items[0].id));
  }

  return (
    <div
      ref={host}
      {...hold.handlers}
      style={{ height: virtual.getTotalSize(), position: "relative" }}
    >
      {virtual.getVirtualItems().map((placement) => {
        const row = rows[placement.index];
        return (
          <div
            key={row.key}
            ref={virtual.measureElement}
            data-index={placement.index}
            className={classes.row}
            style={{ transform: `translateY(${placement.start - virtual.options.scrollMargin}px)` }}
          >
            {"panel" in row ? (
              <RunPanel
                ref={panel}
                run={row.panel}
                columns={columns}
                chat={row.panel.items[0].sessionId}
                chatTitle={chatTitle}
                detail={detail}
                onClose={() => collapse(row.panel)}
              >
                {row.panel.items.map((item) => (
                  <MediaTile
                    key={item.id}
                    item={item}
                    selection={selection}
                    hold={hold}
                    caption={caption}
                    detail={detail(item)}
                    style={{ aspectRatio: `${item.width || 1} / ${item.height || 1}` }}
                    className={classes.fanned}
                    onOpen={() => open(item)}
                    onMenu={() => setMenuItem(item.id)}
                    onSelectionMenu={onSelectionMenu}
                    onTryAgain={onTryAgain}
                    actions={renderActions(item, menuItem === item.id, (opened) =>
                      setMenuItem(opened ? item.id : null),
                    )}
                  />
                ))}
              </RunPanel>
            ) : (
              <div
                className={classes.runs}
                data-stacked={row.runs.some((run) => run.items.length > 1) || undefined}
                style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
              >
                {row.runs.map((run) => {
                  const cover = run.items.find((item) => item.status === "done") || run.items[0];
                  const several = run.items.length > 1;
                  const title = mediaTitle(cover);
                  return (
                    <div key={run.key} className={classes.run}>
                      <MediaTile
                        item={cover}
                        group={run.items}
                        label={
                          selection.selecting
                            ? `Select Run: ${title}, ${countLabel(run)}`
                            : several
                              ? `Run: ${title}, ${countLabel(run)}`
                              : undefined
                        }
                        expanded={several ? expanded === run.key : undefined}
                        selection={selection}
                        hold={hold}
                        caption="none"
                        className={classes.stack}
                        style={{ height: cell }}
                        layers={
                          several && (
                            <div data-run={run.key} className={classes.layers} aria-hidden>
                              {run.items.slice(1, 3).map((item) => {
                                const media = mediaSource(item);
                                const source = media.thumbnailUrl || item.preview || media.url;
                                return (
                                  <div key={item.id} className={classes.layer}>
                                    {source && item.type === "image" && (
                                      <img src={source} alt="" loading="lazy" draggable={false} />
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )
                        }
                        onOpen={() => (several ? void toggle(run) : open(cover))}
                        onMenu={several ? undefined : () => setMenuItem(cover.id)}
                        onSelectionMenu={onSelectionMenu}
                        onTryAgain={onTryAgain}
                        actions={
                          several
                            ? undefined
                            : renderActions(cover, menuItem === cover.id, (opened) =>
                                setMenuItem(opened ? cover.id : null),
                              )
                        }
                      />
                      <div className={classes.caption}>
                        <Text size="sm" fw={500} lineClamp={1}>
                          {title}
                        </Text>
                        <Text size="xs" c="dimmed" lineClamp={1}>
                          {[several && countLabel(run), detail(cover)].filter(Boolean).join(" · ")}
                        </Text>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function RunPanel({
  ref,
  run,
  columns,
  chat,
  chatTitle,
  detail,
  onClose,
  children,
}: {
  ref: React.Ref<HTMLDivElement>;
  run: Run;
  columns: number;
  chat?: string;
  chatTitle: (id: string) => string | undefined;
  detail: (item: MediaItem) => string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const title = mediaTitle(run.items[0]);
  return (
    <Paper
      ref={ref}
      role="region"
      aria-label={`Run: ${title}`}
      withBorder
      radius="lg"
      p="sm"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          onClose();
        }
      }}
    >
      <Group justify="space-between" wrap="nowrap" gap="sm" mb="sm" align="start">
        <Stack gap={2} miw={0}>
          <Text fw={600} truncate>
            {title}
          </Text>
          <Group gap="xs" c="dimmed" fz="xs" wrap="wrap" style={{ rowGap: 0 }}>
            <span>{[countLabel(run), detail(run.items[0])].join(" · ")}</span>
            {chat && (
              <Anchor component={Link} to={`/chat/${chat}`} inherit c="dimmed" underline="always">
                <Group gap={4} wrap="nowrap" component="span">
                  <MessageCircle size={12} />
                  {chatTitle(chat) || "Open Chat"}
                </Group>
              </Anchor>
            )}
          </Group>
        </Stack>
        <Tooltip label="Close Run">
          <ActionIcon aria-label="Close Run" variant="subtle" color="gray" onClick={onClose}>
            <X size={18} />
          </ActionIcon>
        </Tooltip>
      </Group>
      <div
        className={classes.panelGrid}
        style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {children}
      </div>
    </Paper>
  );
}
