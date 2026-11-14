import {
  ActionIcon,
  Alert,
  Button,
  Group,
  SimpleGrid,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";

import { api, post } from "../../api";
import type { MediaItem } from "../../types";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import { layerAbove } from "../../ui/popupClicks";
import { usePhone } from "../../ui/usePhone";
import { projectPath, projectsQuery } from "../dream/queries";
import { MediaTile } from "../gallery/MediaTile";
import { MediaViewer } from "../gallery/MediaViewer";
import { useHoldToSelect } from "../gallery/useGalleryLayout";
import { useTryAgain } from "../gallery/useTryAgain";
import { type Comparison, comparisonQuery } from "./queries";
import { useStageComparison } from "./variants";

import classes from "./ComparePage.module.css";

const titleCase = (text: string) =>
  text.replace(/(^|\s)\p{Ll}/gu, (letter) => letter.toUpperCase());

/**
 * A compare set side by side, labelled by what sets each variant apart: star the winner, take one
 * into the composer (Use This), or bring them all back to change one (Compare Again).
 */
export function ComparePage() {
  const id = useParams().id!;
  const comparison = useQuery(comparisonQuery(id));
  const client = useQueryClient();
  const stage = useStageComparison();
  const [open, setOpen] = useState<MediaItem | null>(null);
  const items = (comparison.data?.variants || []).flatMap((variant) =>
    variant.item ? [variant.item] : [],
  );
  const hold = useHoldToSelect(items, undefined);
  const tryAgain = useTryAgain(items);
  const star = useMutation({
    mutationFn: async (item: MediaItem) => {
      const winner = comparison.data?.winnerItemId === item.id;
      const result = await api<Comparison>(`/api/comparisons/${encodeURIComponent(id)}/vote`, {
        method: "PUT",
        body: JSON.stringify({ itemId: winner ? null : item.id }),
      });
      if (!winner && !item.favorite)
        await post("/api/gallery/favorite", { ids: [item.id], favorite: true });
      return result;
    },
    onSuccess: ({ brief, ...result }) => {
      client.setQueryData(comparisonQuery(id).queryKey, result);
      if (brief) briefChanged(brief);
    },
    onSettled: () =>
      Promise.all(
        [["comparison", id], ["gallery"], ["gallery-filters"]].map((queryKey) =>
          client.invalidateQueries({ queryKey }),
        ),
      ),
  });
  const undoBrief = useMutation({
    mutationFn: (projectId: string) => post(projectPath({ id: projectId }, "undo"), {}),
    onSuccess: () => client.invalidateQueries({ queryKey: projectsQuery.queryKey }),
  });
  /** The pick's addition to the project's brief, with Undo. */
  function briefChanged({ projectId, name }: NonNullable<Comparison["brief"]>) {
    void client.invalidateQueries({ queryKey: projectsQuery.queryKey });
    const notification = notifications.show({
      autoClose: 10000,
      message: (
        <Group justify="space-between" wrap="nowrap">
          <Text size="sm">Added to {name}'s brief</Text>
          <Button
            size="compact-sm"
            variant="subtle"
            onClick={() => {
              notifications.hide(notification);
              undoBrief.mutate(projectId);
            }}
          >
            Undo
          </Button>
        </Group>
      ),
    });
  }
  const use = useMutation({ mutationFn: (item: MediaItem) => stage.useThis(item) });
  const compareAgain = useMutation({ mutationFn: () => stage.again(again) });
  // 1–4 star that variant as the winner (again to clear it), unless typing or a layer is above.
  const pick = useRef<(index: number) => void>(undefined);
  pick.current = (index) => {
    const item = comparison.data?.variants[index]?.item;
    if (item?.status === "done" && !star.isPending) star.mutate(item);
  };
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!/^[1-4]$/.test(event.key) || event.defaultPrevented) return;
      if (event.altKey || event.metaKey || event.ctrlKey) return;
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable='true']")) return;
      if (layerAbove(null, event)) return;
      event.preventDefault();
      pick.current?.(Number(event.key) - 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (comparison.isPending) return <LoadingState fill label="Loading Comparison" />;
  if (comparison.error)
    return (
      <Alert color="red" title="Couldn't Load the Comparison">
        {comparison.error.message}
      </Alert>
    );
  const { variants, seed, prompt, negative, set, axis } = comparison.data;
  const winner = items.find((item) => item.id === comparison.data.winnerItemId);
  // Compare Again brings back every finished variant, the winner first.
  const again = items
    .filter((item) => item.status === "done")
    .sort((a, b) => Number(b === winner) - Number(a === winner));
  const sized = items.find((item) => item.width && item.height);
  const aspect = sized ? sized.width! / sized.height! : 1;
  return (
    <Stack gap="md" className={classes.page}>
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Group gap="xs" wrap="nowrap" miw={0}>
          <Tooltip label={set ? "Show in Gallery" : "Back to Images"}>
            <ActionIcon
              component={Link}
              to={set ? `/images?${new URLSearchParams({ set })}` : "/images"}
              variant="subtle"
              color="gray"
              aria-label={set ? "Show in Gallery" : "Back to Images"}
            >
              <ArrowLeft size={18} />
            </ActionIcon>
          </Tooltip>
          <Title order={1} size="h3">
            {axis ? `Which ${titleCase(axis)}?` : "Compare"}
          </Title>
        </Group>
        <Text size="sm" c="dimmed" ta="right">
          {[`${variants.length} Variants`, seed && `Seed ${seed}`].filter(Boolean).join(" · ")}
        </Text>
      </Group>
      {(prompt || negative) && (
        <Stack gap={4}>
          {prompt && (
            <Text size="sm" lineClamp={3}>
              Prompt: {prompt}
            </Text>
          )}
          {negative && (
            <Text size="xs" c="dimmed" lineClamp={2}>
              Negative: {negative}
            </Text>
          )}
        </Stack>
      )}
      <Variants count={variants.length} aspect={aspect}>
        {variants.map(({ jobId, label, item }) => {
          const won = comparison.data.winnerItemId === item?.id;
          return (
            <Stack
              key={item?.id || jobId}
              gap={6}
              className={classes.variant}
              data-winner={won || undefined}
            >
              <Text size="sm" fw={600} truncate title={label}>
                {label}
              </Text>
              {item ? (
                <MediaTile
                  item={item}
                  hold={hold}
                  caption="none"
                  label={`Open ${label}`}
                  className={classes.tile}
                  style={{ aspectRatio: `${item.width || 1} / ${item.height || 1}` }}
                  onOpen={() => item.status === "done" && setOpen(item)}
                  onTryAgain={(failed) => tryAgain([failed.jobId || ""]).then(() => undefined)}
                  actions={
                    item.status === "done" && (
                      <Tooltip label={won ? "Clear Winner" : "Star as Winner"}>
                        <ActionIcon
                          className={classes.star}
                          variant={won ? "filled" : "default"}
                          size="lg"
                          aria-label={won ? `Clear Winner ${label}` : `Star ${label} as Winner`}
                          aria-pressed={won}
                          loading={star.isPending && star.variables?.id === item.id}
                          onClick={() => star.mutate(item)}
                        >
                          <icons.winner size={18} fill={won ? "currentColor" : "none"} />
                        </ActionIcon>
                      </Tooltip>
                    )
                  }
                />
              ) : (
                <Text size="sm" c="dimmed" className={classes.missing}>
                  Image Unavailable
                </Text>
              )}
              {item?.status === "done" && (
                <Button
                  variant="default"
                  size="xs"
                  aria-label={`Use ${label}`}
                  loading={use.isPending && use.variables?.id === item.id}
                  onClick={() => use.mutate(item)}
                >
                  Use This
                </Button>
              )}
              {!prompt && item?.prompt && (
                <Text size="xs" c="dimmed" lineClamp={3}>
                  Prompt: {item.prompt}
                </Text>
              )}
              {negative === undefined && item?.negative && (
                <Text size="xs" c="dimmed" lineClamp={2}>
                  Negative: {item.negative}
                </Text>
              )}
            </Stack>
          );
        })}
      </Variants>
      {again.length > 1 && (
        <Group justify="center" className={classes.applied}>
          <Button loading={compareAgain.isPending} onClick={() => compareAgain.mutate()}>
            Compare Again
          </Button>
        </Group>
      )}
      {open && (
        <MediaViewer
          item={items.find((candidate) => candidate.id === open.id) || open}
          items={items}
          navigate={setOpen}
          close={() => setOpen(null)}
        />
      )}
    </Stack>
  );
}

/** The variants as a grid that fits the viewport on desktop, or a swiped row of one on phones. */
function Variants({
  count,
  aspect,
  children,
}: {
  count: number;
  aspect: number;
  children: ReactNode;
}) {
  const phone = usePhone();
  const track = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(0);
  if (!phone) {
    const columns = count <= 4 ? count : Math.ceil(count / 2);
    return (
      <SimpleGrid
        cols={columns}
        spacing="sm"
        className={classes.grid}
        style={{
          "--compare-columns": columns,
          "--compare-rows": Math.ceil(count / columns),
          "--compare-aspect": aspect,
        }}
      >
        {children}
      </SimpleGrid>
    );
  }
  const move = (step: number) => {
    const element = track.current!;
    element.scrollTo({ left: (shown + step) * element.clientWidth });
  };
  return (
    <Stack gap="xs">
      <Group justify="space-between" wrap="nowrap">
        <ActionIcon
          variant="default"
          aria-label="Previous Variant"
          disabled={shown === 0}
          onClick={() => move(-1)}
        >
          <icons.previous size={20} />
        </ActionIcon>
        <Text size="sm" c="dimmed" aria-live="polite">
          {shown + 1} of {count}
        </Text>
        <ActionIcon
          variant="default"
          aria-label="Next Variant"
          disabled={shown === count - 1}
          onClick={() => move(1)}
        >
          <icons.next size={20} />
        </ActionIcon>
      </Group>
      <div
        ref={track}
        className={classes.track}
        onScroll={(event) =>
          setShown(
            Math.round(event.currentTarget.scrollLeft / (event.currentTarget.clientWidth || 1)),
          )
        }
      >
        {children}
      </div>
    </Stack>
  );
}
