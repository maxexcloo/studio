import { Alert, Button, Group, VisuallyHidden } from "@mantine/core";
import { useInfiniteQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useId, useMemo, useState } from "react";

import { EmptyState } from "../../ui/EmptyState";
import { ViewMenu } from "../../ui/ViewMenu";
import { DreamDeck, type Judgement } from "../dream/DreamDeck";
import { dateCutoff, galleryDates, ratingChoices } from "./GalleryFilters";
import { type GalleryListing, type GalleryReviewRating, galleryReviewQuery } from "./queries";
import { reviewSuggestionCount } from "./usePrefetchResultSuggestions";

import toolbarClasses from "../../ui/PageToolbar.module.css";
import classes from "../dream/DreamPage.module.css";
import filterClasses from "./GalleryFilters.module.css";

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
  const [time, setTime] = useState("all");
  const [rating, setRating] = useState<GalleryReviewRating>(listing.filters.rating || "unrated");
  const times = [
    { value: "all", label: "All" },
    ...galleryDates,
    ...(leftAt ? [{ value: "visit", label: "New Since Last Visit" }] : []),
  ];
  const since =
    time === "all"
      ? 0
      : time === "visit"
        ? leftAt + 1
        : dateCutoff(time as Parameters<typeof dateCutoff>[0]).getTime();
  return (
    <section className={classes.page} aria-labelledby={id}>
      <VisuallyHidden id={id} component="h1">
        Review
      </VisuallyHidden>
      <div className={toolbarClasses.band}>
        <Group gap="xs" mih={44} wrap="nowrap" className={filterClasses.mode}>
          {view}
          <div className={filterClasses.chips} />
          <ViewMenu label="Time" value={time} groups={[times]} onChange={setTime} />
          <ViewMenu label="Rating" value={rating} groups={[ratingChoices]} onChange={setRating} />
        </Group>
      </div>
      <GalleryReviewDeck
        key={`${rating}:${time}`}
        listing={listing}
        rating={rating}
        since={since}
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
  const items = useMemo(
    () =>
      review.data?.pages.flatMap((page) => page.items.filter(({ id }) => !decided.has(id))) ?? [],
    [decided, review.data],
  );
  const { fetchNextPage, hasNextPage, isFetchingNextPage, isFetchNextPageError } = review;
  useEffect(() => {
    if (
      items.length <= reviewSuggestionCount &&
      hasNextPage &&
      !isFetchingNextPage &&
      !isFetchNextPageError
    )
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
              size="compact-sm"
              variant="default"
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
