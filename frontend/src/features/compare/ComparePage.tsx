import { useState } from "react";
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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Star } from "lucide-react";
import { Link, useParams } from "react-router";
import { api, post } from "../../api";
import type { MediaItem } from "../../types";
import { LoadingState } from "../../ui/LoadingState";
import { MediaTile } from "../gallery/MediaTile";
import { MediaViewer } from "../gallery/MediaViewer";
import { mediaDraft } from "../gallery/useMediaAction";
import { useHoldToSelect } from "../gallery/useGalleryLayout";
import { useTryAgain } from "../gallery/useTryAgain";
import { useGenerationActions } from "../generation/GenerationProvider";
import { useCompare } from "./CompareDialog";
import { comparisonQuery, type Comparison } from "./queries";
import classes from "./ComparePage.module.css";

/** A compare set side by side; starring the winner loads its settings, and Compare Again starts from it. */
export function ComparePage() {
  const id = useParams().id!;
  const comparison = useQuery(comparisonQuery(id));
  const client = useQueryClient();
  const { profiles, setDraft } = useGenerationActions();
  const compare = useCompare();
  const [open, setOpen] = useState<MediaItem | null>(null);
  const items = (comparison.data?.variants || []).flatMap((variant) =>
    variant.item ? [variant.item] : [],
  );
  const hold = useHoldToSelect(items, undefined);
  const tryAgain = useTryAgain(items);
  const star = useMutation({
    mutationFn: async (item: MediaItem) => {
      const winner = comparison.data?.vote === item.jobId;
      const result = await api<Comparison>(`/api/comparisons/${encodeURIComponent(id)}/vote`, {
        method: "PUT",
        body: JSON.stringify({ jobId: winner ? null : item.jobId }),
      });
      if (!winner) {
        if (!item.favorite) await post("/api/gallery/favorite", { ids: [item.id], favorite: true });
        // The winner's exact settings, seed included, so the next run starts from it.
        const { draft, seed } = await mediaDraft(item, "image", profiles, client);
        setDraft({ ...draft, input: { ...draft.input, seed: seed ?? "" } });
      }
      return result;
    },
    onSuccess: (result) => client.setQueryData(comparisonQuery(id).queryKey, result),
    onSettled: () =>
      Promise.all(
        [["comparison", id], ["gallery"], ["gallery-filters"]].map((queryKey) =>
          client.invalidateQueries({ queryKey }),
        ),
      ),
  });
  if (comparison.isPending) return <LoadingState fill label="Loading Comparison" />;
  if (comparison.error)
    return (
      <Alert color="red" title="Couldn’t Load the Comparison">
        {comparison.error.message}
      </Alert>
    );
  const { variants, vote, seed, prompt, negative } = comparison.data;
  const winner = items.find((item) => item.jobId === vote);
  const sized = items.find((item) => item.width && item.height);
  const aspect = sized ? sized.width! / sized.height! : 1;
  return (
    <Stack gap="md" className={classes.page}>
      <Group justify="space-between" wrap="nowrap" gap="sm">
        <Group gap="xs" wrap="nowrap" miw={0}>
          <Tooltip label="Back to Images">
            <ActionIcon
              component={Link}
              to="/images"
              variant="subtle"
              color="gray"
              aria-label="Back to Images"
            >
              <ArrowLeft size={18} />
            </ActionIcon>
          </Tooltip>
          <Title order={1} size="h3">
            Compare
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
              {prompt}
            </Text>
          )}
          {negative && (
            <Text size="xs" c="dimmed" lineClamp={2}>
              Negative: {negative}
            </Text>
          )}
        </Stack>
      )}
      <SimpleGrid
        cols={{ base: 2, sm: variants.length }}
        spacing="sm"
        className={classes.grid}
        // Side by side, every variant fits the viewport height.
        style={{ "--compare-columns": variants.length, "--compare-aspect": aspect }}
      >
        {variants.map(({ jobId, label, item }) => {
          const won = vote === jobId;
          return (
            <Stack key={jobId} gap={6} className={classes.variant} data-winner={won || undefined}>
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
                          radius="xl"
                          size="lg"
                          aria-label={won ? `Clear Winner ${label}` : `Star ${label} as Winner`}
                          aria-pressed={won}
                          loading={star.isPending && star.variables?.id === item.id}
                          onClick={() => star.mutate(item)}
                        >
                          <Star size={18} fill={won ? "currentColor" : "none"} />
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
              {!prompt && item?.prompt && (
                <Text size="xs" c="dimmed" lineClamp={3}>
                  {item.prompt}
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
      </SimpleGrid>
      {winner && (
        <Group justify="center" gap="sm" className={classes.applied}>
          {star.isSuccess && (
            <Text size="sm" c="dimmed">
              The winner’s settings are in the composer.
            </Text>
          )}
          <Button variant="default" onClick={() => void compare.openItem(winner)}>
            Compare Again
          </Button>
          {star.isSuccess && (
            <Button component={Link} to="/images?compose=1">
              Open Composer
            </Button>
          )}
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
