import { Alert, Button, Group, Stack, VisuallyHidden } from "@mantine/core";
import { useInfiniteQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useId, useState } from "react";

import type { MediaItem } from "../../types";
import { ChipPopup } from "../../ui/ChipPopup";
import { EmptyState } from "../../ui/EmptyState";
import { FilterChoices } from "../../ui/SectionToolbar";
import { DreamDeck, type Judgement } from "../dream/DreamDeck";
import { FilterButton } from "../generation/Picker";
import { type GalleryListing, type GalleryReviewRating, galleryReviewQuery } from "./queries";

import toolbarClasses from "../../ui/PageToolbar.module.css";
import classes from "../dream/DreamPage.module.css";
import filterClasses from "./GalleryFilters.module.css";

const day = 24 * 60 * 60 * 1000;
const ratings = [
  { value: "unrated", label: "Unrated" },
  { value: "liked", label: "Liked" },
  { value: "disliked", label: "Disliked" },
];

export function GalleryReview({
  listing,
  leftAt,
  close,
  view,
}: {
  listing: GalleryListing;
  leftAt: number;
  /** Leaves Review for the gallery it opened from. */
  close: () => void;
  view: ReactNode;
}) {
  const id = useId();
  const [openedAt] = useState(Date.now);
  const [cutoff, setCutoff] = useState("0");
  const [rating, setRating] = useState<GalleryReviewRating>(listing.filters.rating || "unrated");
  const [filtering, setFiltering] = useState(false);
  const filterCount = Number(cutoff !== "0") + Number(rating !== "unrated");
  const times = [
    { value: String(openedAt - day), label: "Last 24 Hours" },
    { value: String(openedAt - 7 * day), label: "Last 7 Days" },
    ...(leftAt ? [{ value: String(leftAt + 1), label: "New Since Last Gallery Visit" }] : []),
  ];
  return (
    <section className={classes.page} aria-labelledby={id}>
      <VisuallyHidden id={id} component="h1">
        Review
      </VisuallyHidden>
      <div className={toolbarClasses.band}>
        <Group gap="xs" mih={44} wrap="nowrap" className={filterClasses.mode}>
          {view}
          <ChipPopup
            title="Filters"
            spacious={false}
            opened={filtering}
            onOpenedChange={setFiltering}
            width={340}
            position="bottom-start"
            clearDisabled={!filterCount}
            onClear={() => {
              setCutoff("0");
              setRating("unrated");
            }}
            target={
              <FilterButton
                label="Review Filters"
                count={filterCount}
                opened={filtering}
                onClick={() => setFiltering(!filtering)}
              />
            }
          >
            <Stack gap="sm">
              <FilterChoices
                label="Time"
                data={times}
                value={cutoff === "0" ? null : cutoff}
                onChange={(value) => setCutoff(value ?? "0")}
              />
              <FilterChoices
                label="Rating"
                data={ratings}
                value={rating === "all" ? null : rating}
                onChange={(value) => setRating((value ?? "all") as GalleryReviewRating)}
              />
            </Stack>
          </ChipPopup>
        </Group>
      </div>
      <GalleryReviewDeck
        key={`${rating}:${cutoff}`}
        listing={listing}
        rating={rating}
        since={Number(cutoff)}
        close={close}
      />
    </section>
  );
}

function GalleryReviewDeck({
  listing,
  rating,
  since,
  close,
}: {
  listing: GalleryListing;
  rating: GalleryReviewRating;
  since: number;
  close: () => void;
}) {
  const [decided, setDecided] = useState<Set<string>>(() => new Set());
  const [history, setHistory] = useState<Judgement[]>([]);
  const review = useInfiniteQuery(galleryReviewQuery(listing, rating, since));
  const items: MediaItem[] =
    review.data?.pages.flatMap((page) => page.items.filter((item) => !decided.has(item.id))) ?? [];
  const { fetchNextPage, hasNextPage, isFetchingNextPage, isFetchNextPageError } = review;
  useEffect(() => {
    if (items.length < 3 && hasNextPage && !isFetchingNextPage && !isFetchNextPageError)
      void fetchNextPage();
  }, [items.length, fetchNextPage, hasNextPage, isFetchingNextPage, isFetchNextPageError]);
  return (
    <DreamDeck
      quickRating
      onSuggestionApplied={close}
      items={[]}
      setDecided={setDecided}
      history={history}
      setHistory={setHistory}
      returnItems={() => {}}
      libraryItems={items}
      libraryWaiting={
        review.isPending || isFetchingNextPage || (!!hasNextPage && !isFetchNextPageError)
      }
      media={listing.kind}
      empty={
        review.isError ? (
          <Alert color="red" title="Couldn't Load Results">
            <Button
              variant="subtle"
              onClick={() => void (hasNextPage ? fetchNextPage() : review.refetch())}
            >
              Retry
            </Button>
          </Alert>
        ) : (
          <EmptyState fill>
            {rating === "unrated" ? "No Unrated Results" : "No Results to Review"}
          </EmptyState>
        )
      }
    />
  );
}
