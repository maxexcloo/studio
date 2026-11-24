import {
  ActionIcon,
  Alert,
  Button,
  Group,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  Suspense,
  lazy,
  useEffect,
  useRef,
  useState,
} from "react";
import { Link, useLocation, useParams } from "react-router";

import { api, post } from "../../api";
import type { MediaItem } from "../../types";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import { plural } from "../../ui/plural";
import { layerAbove } from "../../ui/popupClicks";
import { usePhone } from "../../ui/usePhone";
import { useRemembered } from "../auth/useRemembered";
import { inboxQuery } from "../dream/queries";
import type { ComparisonImage } from "../gallery/MediaComparison";
import { mediaSource } from "../gallery/mediaSource";
import { MediaTile } from "../gallery/MediaTile";
import { MediaViewer } from "../gallery/MediaViewer";
import { galleryKey } from "../gallery/queries";
import { useGalleryColumns, useHoldToSelect } from "../gallery/useGalleryLayout";
import { useTryAgain } from "../gallery/useTryAgain";
import { type GalleryState, galleryViewPath } from "../gallery/viewerLink";
import { ComparisonRatingButtons } from "./ComparisonRatingButtons";
import { type Comparison, comparisonQuery, comparisonTitle, comparisonsQuery } from "./queries";
import { useStageComparison } from "./variants";

import classes from "./ComparePage.module.css";

const MediaComparison = lazy(() =>
  import("../gallery/MediaComparison").then((module) => ({ default: module.MediaComparison })),
);
type SplitImage = ComparisonImage & { value: string; width?: number; height?: number };

/**
 * A compare set side by side, labelled by what sets each variant apart: pick the winner (liking it), take one
 * into the composer (Use This), or bring them all back to change one (Compare Again).
 */
export function ComparePage() {
  const id = useParams().id!;
  const location = useLocation();
  const comparisonSearch = (location.state as { comparisonSearch?: string } | null)
    ?.comparisonSearch;
  const comparison = useQuery(comparisonQuery(id));
  const client = useQueryClient();
  const stage = useStageComparison();
  const phone = usePhone();
  const [open, setOpen] = useState<MediaItem | null>(null);
  const items = (comparison.data?.variants || []).flatMap((variant) =>
    variant.item ? [variant.item] : [],
  );
  const hold = useHoldToSelect(items, undefined);
  const tryAgain = useTryAgain(items);
  const choose = useMutation({
    mutationFn: async (item: MediaItem) => {
      const winner = comparison.data?.winnerItemId === item.id;
      const result = await api<Comparison>(`/api/comparisons/${encodeURIComponent(id)}/vote`, {
        method: "PUT",
        body: JSON.stringify({ itemId: winner ? null : item.id }),
      });
      if (!winner && item.rating !== "liked")
        await post("/api/gallery/favorite", { ids: [item.id], rating: "liked" });
      return result;
    },
    onSuccess: ({ proposal, ...result }) => {
      client.setQueryData(comparisonQuery(id).queryKey, result);
      if (!proposal) return;
      void client.invalidateQueries({ queryKey: inboxQuery.queryKey });
      notifications.show({ message: `Proposed for ${proposal.name}'s brief in Dream's Inbox` });
    },
    onSettled: () =>
      Promise.all(
        [
          comparisonQuery(id).queryKey,
          comparisonsQuery.queryKey,
          galleryKey,
          ["gallery-filters"],
          // A card's Generate References: the winner joined its images.
          ...(comparison.data?.card ? [[comparison.data.card.kind]] : []),
        ].map((queryKey) => client.invalidateQueries({ queryKey })),
      ),
  });
  const use = useMutation({ mutationFn: (item: MediaItem) => stage.useThis(item) });
  const compareAgain = useMutation({ mutationFn: () => stage.again(again) });
  // 1–9 pick that variant as the winner and 0 the tenth (again to clear it), unless typing or a
  // layer is above.
  const pick = useRef<(index: number) => void>(undefined);
  pick.current = (index) => {
    const item = comparison.data?.variants[index]?.item;
    if (item?.status === "done" && !comparison.data?.dream && !choose.isPending)
      choose.mutate(item);
  };
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!/^\d$/.test(event.key) || event.defaultPrevented) return;
      if (event.altKey || event.metaKey || event.ctrlKey) return;
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable='true']")) return;
      if (layerAbove(null, event)) return;
      event.preventDefault();
      pick.current?.((Number(event.key) + 9) % 10);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  if (comparison.isPending) return <LoadingState fill label="Loading Comparison" />;
  if (comparison.error)
    return (
      <Alert color="red" title="Couldn't Load the Comparison">
        <Stack gap="sm" align="flex-start">
          {comparison.error.message}
          <Button variant="subtle" onClick={() => void comparison.refetch()}>
            Retry
          </Button>
        </Stack>
      </Alert>
    );
  const { variants, seed, prompt, negative, set, axis, dream, card } = comparison.data;
  const gallerySet = comparisonSearch === undefined ? set : undefined;
  const backLabel = gallerySet ? "Show in Gallery" : "Back to Comparisons";
  const winner = items.find((item) => item.id === comparison.data.winnerItemId);
  const splitImages = variants.flatMap(({ label, item }) => {
    if (item?.type !== "image" || item.status !== "done" || !item.url) return [];
    const source = mediaSource(item);
    return [
      {
        value: item.id,
        label,
        src: source.displayUrl || source.url,
        width: source.width,
        height: source.height,
      },
    ];
  });
  // Compare Again brings back every finished variant, the winner first.
  const again = items
    .filter((item) => item.status === "done")
    .sort((a, b) => Number(b === winner) - Number(a === winner));
  // The tallest variant sets the shared width in Side by Side.
  const aspects = items.flatMap((item) =>
    item.width && item.height ? [item.width / item.height] : [],
  );
  const aspect = aspects.length ? Math.min(...aspects) : 1;
  return (
    <Stack gap="md" className={classes.page}>
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Group gap="xs" wrap="nowrap" miw={0}>
          <Tooltip label={backLabel}>
            <ActionIcon
              component={Link}
              to={
                gallerySet
                  ? "/images"
                  : `${galleryViewPath("image", "comparisons")}${comparisonSearch || ""}`
              }
              state={gallerySet ? ({ set: gallerySet } satisfies GalleryState) : undefined}
              variant="subtle"
              color="gray"
              aria-label={backLabel}
            >
              <ArrowLeft size={18} />
            </ActionIcon>
          </Tooltip>
          <Title order={1} size="h3">
            {comparisonTitle({ axis, dream })}
          </Title>
        </Group>
        <Group gap="xs" justify="flex-end" wrap="nowrap">
          <Text size="sm" c="dimmed" ta="right">
            {[plural(variants.length, "Variant"), seed && `Seed ${seed}`]
              .filter(Boolean)
              .join(" · ")}
          </Text>
          <ComparisonRatingButtons comparison={comparison.data} />
          {again.length > 1 &&
            (phone ? (
              <Tooltip label="Compare Again">
                <ActionIcon
                  variant="filled"
                  aria-label="Compare Again"
                  loading={compareAgain.isPending}
                  onClick={() => compareAgain.mutate()}
                >
                  <icons.compare size={18} />
                </ActionIcon>
              </Tooltip>
            ) : (
              <Button
                size="xs"
                loading={compareAgain.isPending}
                onClick={() => compareAgain.mutate()}
              >
                Compare Again
              </Button>
            ))}
        </Group>
      </Group>
      {card && (
        <Text size="sm" c="dimmed">
          {`The winner joins ${card.name}'s images in Library.`}
        </Text>
      )}
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
      <Variants count={variants.length} aspect={aspect} splitImages={splitImages}>
        {variants.map(({ jobId, label, item }) => {
          const won = comparison.data.winnerItemId === item?.id;
          return (
            <Stack
              key={item?.id || jobId}
              gap={6}
              className={classes.variant}
              data-winner={won || undefined}
              // Scroll fits each variant to the view by its own shape.
              style={
                item?.width && item.height
                  ? ({ "--compare-aspect": item.width / item.height } as CSSProperties)
                  : undefined
              }
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
                    // Dream's answer stands: its kept side is the winner.
                    item.status === "done" &&
                    !dream && (
                      <Tooltip label={won ? "Clear Winner" : "Pick as Winner"}>
                        <ActionIcon
                          className={classes.winner}
                          variant={won ? "filled" : "default"}
                          size="lg"
                          aria-label={won ? `Clear Winner ${label}` : `Pick ${label} as Winner`}
                          aria-pressed={won}
                          loading={choose.isPending && choose.variables?.id === item.id}
                          onClick={() => choose.mutate(item)}
                        >
                          <icons.winner size={18} fill={won ? "currentColor" : "none"} />
                        </ActionIcon>
                      </Tooltip>
                    )
                  }
                />
              ) : (
                <Text size="sm" c="dimmed" className={classes.missing}>
                  Unavailable
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

type Layout = "side" | "scroll" | "split";

function SplitVariants({ images }: { images: SplitImage[] }) {
  const [firstId, setFirst] = useState<string>();
  const [secondId, setSecond] = useState<string>();
  const first = images.find(({ value }) => value === firstId) ?? images[0];
  const others = images.filter(({ value }) => value !== first.value);
  const second = others.find(({ value }) => value === secondId) ?? others[0];
  return (
    <Stack
      gap="xs"
      className={classes.splitColumn}
      style={{ "--split-aspect": (second.width || 1) / (second.height || 1) } as CSSProperties}
    >
      {images.length > 2 && (
        <SimpleGrid cols={2} spacing="xs">
          <Select
            label="First Variant"
            data={images}
            value={first.value}
            onChange={(value) => value && setFirst(value)}
            allowDeselect={false}
          />
          <Select
            label="Second Variant"
            data={others}
            value={second.value}
            onChange={(value) => value && setSecond(value)}
            allowDeselect={false}
          />
        </SimpleGrid>
      )}
      <div className={classes.split}>
        <Suspense fallback={<LoadingState label="Loading Comparison" fill />}>
          <MediaComparison
            key={JSON.stringify([first.value, second.value])}
            first={first}
            second={second}
            inPage
            width={second.width}
            height={second.height}
          />
        </Suspense>
      </div>
    </Stack>
  );
}

/**
 * The variants side by side, one at a time in a swiped row, or two finished images under one split.
 */
function Variants({
  count,
  aspect,
  splitImages,
  children,
}: {
  count: number;
  aspect: number;
  splitImages: SplitImage[];
  children: ReactNode;
}) {
  const phone = usePhone();
  const { columns: gallery } = useGalleryColumns();
  const [saved, setLayout] = useRemembered<Layout | null>("compare-layout", null);
  const canSplit = splitImages.length >= 2;
  const layout = saved && (saved !== "split" || canSplit) ? saved : phone ? "scroll" : "side";
  const track = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(0);
  const columns = Math.min(count, gallery);
  const move = (step: number) => {
    const element = track.current!;
    const index = Math.max(0, Math.min(count - 1, shown + step));
    element.scrollTo({ left: index * element.clientWidth, behavior: "instant" });
    setShown(index);
  };
  return (
    <Stack gap="xs">
      <Group justify="space-between" wrap="nowrap">
        <SegmentedControl
          aria-label="Compare Layout"
          size="xs"
          value={layout}
          onChange={(value) => {
            setShown(0);
            setLayout(value as Layout);
          }}
          data={[
            { value: "side", label: "Side by Side" },
            { value: "scroll", label: "Scroll" },
            ...(canSplit ? [{ value: "split", label: "Split" }] : []),
          ]}
        />
        {layout === "scroll" && (
          <Group gap="xs" wrap="nowrap">
            <Tooltip label="Previous Variant">
              <ActionIcon
                variant="default"
                aria-label="Previous Variant"
                disabled={shown === 0}
                onClick={() => move(-1)}
              >
                <icons.previous size={20} />
              </ActionIcon>
            </Tooltip>
            <Text size="sm" c="dimmed" aria-live="polite">
              {shown + 1} of {count}
            </Text>
            <Tooltip label="Next Variant">
              <ActionIcon
                variant="default"
                aria-label="Next Variant"
                disabled={shown === count - 1}
                onClick={() => move(1)}
              >
                <icons.next size={20} />
              </ActionIcon>
            </Tooltip>
          </Group>
        )}
      </Group>
      {layout === "split" ? (
        <SplitVariants images={splitImages} />
      ) : layout === "side" ? (
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
      ) : (
        <div
          ref={track}
          className={classes.track}
          role="region"
          aria-label="Comparison Variants"
          style={{ "--compare-aspect": aspect } as CSSProperties}
          onScroll={(event) =>
            setShown(
              Math.round(event.currentTarget.scrollLeft / (event.currentTarget.clientWidth || 1)),
            )
          }
        >
          {children}
        </div>
      )}
    </Stack>
  );
}
