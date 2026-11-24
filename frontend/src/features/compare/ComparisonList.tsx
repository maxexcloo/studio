import { Alert, Button, Group, SimpleGrid, Stack, Text, VisuallyHidden } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";

import { EmptyState } from "../../ui/EmptyState";
import { LoadingState } from "../../ui/LoadingState";
import { plural } from "../../ui/plural";
import { ViewMenu } from "../../ui/ViewMenu";
import { mediaTitle } from "../gallery/mediaLabels";
import { MediaTile } from "../gallery/MediaTile";
import { useGalleryColumns, useHoldToSelect } from "../gallery/useGalleryLayout";
import { ComparisonRatingButtons } from "./ComparisonRatingButtons";
import { comparisonTitle, comparisonsQuery } from "./queries";

import filterClasses from "../gallery/GalleryFilters.module.css";
import toolbarClasses from "../../ui/PageToolbar.module.css";
import galleryClasses from "../gallery/GalleryPage.module.css";

const ratings = [
  { value: "all", label: "All Ratings" },
  { value: "liked", label: "Liked" },
  { value: "disliked", label: "Disliked" },
] as const;

/**
 * The gallery's Comparisons view: a card per comparison or kept Dream comparison, newest first,
 * opening all its variants.
 */
export function ComparisonList({ view }: { view: ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const requested = params.get("rating");
  const rating = requested === "liked" || requested === "disliked" ? requested : "all";
  const { columns } = useGalleryColumns();
  const comparisons = useQuery(comparisonsQuery);
  // The winner, else the first variant with media, else the first still in the gallery, is the cover.
  const cards = (comparisons.data?.comparisons || []).flatMap((comparison) => {
    if (rating !== "all" && comparison.rating !== rating) return [];
    const items = comparison.variants.flatMap(({ item }) => (item ? [item] : []));
    const cover =
      items.find((item) => item.id === comparison.winnerItemId) ||
      items.find((item) => item.url) ||
      items[0];
    if (!cover) return [];
    // A run's variants are named by their labels as given, which their set titles title-case.
    const title =
      comparison.axis || comparison.dream
        ? comparisonTitle(comparison)
        : cover.resultSet?.id === comparison.id
          ? comparison.variants.find(({ item }) => item === cover)!.label
          : mediaTitle(cover);
    return [{ comparison, cover, title }];
  });
  const hold = useHoldToSelect(
    cards.map(({ cover }) => cover),
    undefined,
  );
  return (
    <Stack gap="sm" className={galleryClasses.page}>
      <VisuallyHidden component="h1">Comparisons</VisuallyHidden>
      <div className={toolbarClasses.band}>
        <Group gap="xs" mih={44} wrap="nowrap" className={filterClasses.mode}>
          {view}
          <div className={filterClasses.chips} />
          <ViewMenu
            label="Rating"
            value={rating}
            groups={[ratings]}
            onChange={(value) =>
              setParams(value === "all" ? {} : { rating: value }, {
                replace: true,
                state: location.state,
              })
            }
          />
        </Group>
      </div>
      {comparisons.isPending ? (
        <LoadingState fill label="Loading Comparisons" />
      ) : comparisons.error ? (
        <Alert color="red" title="Couldn't Load Comparisons">
          <Stack gap="sm" align="flex-start">
            {comparisons.error.message}
            <Button variant="subtle" onClick={() => void comparisons.refetch()}>
              Retry
            </Button>
          </Stack>
        </Alert>
      ) : cards.length ? (
        <SimpleGrid cols={columns} spacing="sm" style={{ alignItems: "start" }}>
          {cards.map(({ comparison, cover, title }) => (
            <Stack key={comparison.id} gap={4} miw={0}>
              <MediaTile
                item={cover}
                hold={hold}
                caption="none"
                label={`Open Comparison: ${title}`}
                style={{ aspectRatio: `${cover.width || 1} / ${cover.height || 1}` }}
                onOpen={() =>
                  void navigate(`/compare/${encodeURIComponent(comparison.id)}`, {
                    state: { comparisonSearch: location.search },
                  })
                }
              />
              <Group justify="space-between" gap="xs" wrap="nowrap">
                <Text size="sm" fw={500} truncate title={title}>
                  {title}
                </Text>
                <ComparisonRatingButtons comparison={comparison} />
              </Group>
              <Text size="xs" c="dimmed">
                {plural(comparison.variants.length, "Variant")}
                {comparison.winnerItemId && " · Winner Picked"}
              </Text>
            </Stack>
          ))}
        </SimpleGrid>
      ) : (
        <EmptyState fill>
          {rating === "liked"
            ? "No Liked Comparisons"
            : rating === "disliked"
              ? "No Disliked Comparisons"
              : "No Comparisons"}
        </EmptyState>
      )}
    </Stack>
  );
}
