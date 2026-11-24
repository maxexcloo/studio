import { Alert, Button, Group, VisuallyHidden } from "@mantine/core";
import { useInfiniteQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useId, useMemo, useState } from "react";

import { EmptyState } from "../../ui/EmptyState";
import { ViewMenu } from "../../ui/ViewMenu";
import { DreamDeck, type Judgement } from "../dream/DreamDeck";
import { type GalleryListing, type GalleryReviewRating, galleryReviewQuery } from "./queries";
import { reviewSuggestionCount } from "./usePrefetchResultSuggestions";

import toolbarClasses from "../../ui/PageToolbar.module.css";
import classes from "../dream/DreamPage.module.css";
import filterClasses from "./GalleryFilters.module.css";

const day = 24 * 60 * 60 * 1000;
const ratings: { value: GalleryReviewRating; label: string }[] = [
  { value: "all", label: "All Ratings" },
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
  const times = [
    { value: "0", label: "All Time" },
    { value: String(openedAt - day), label: "Last 24 Hours" },
    { value: String(openedAt - 7 * day), label: "Last 7 Days" },
    ...(leftAt ? [{ value: String(leftAt + 1), label: "New Since Last Visit" }] : []),
  ];
  return (
    <section className={classes.page} aria-labelledby={id}>
      <VisuallyHidden id={id} component="h1">
        Review
      </VisuallyHidden>
      <div className={toolbarClasses.band}>
        <Group gap="xs" mih={44} wrap="nowrap" className={filterClasses.mode}>
          {view}
          <div className={filterClasses.chips} />
          <ViewMenu label="Time" value={cutoff} groups={[times]} onChange={setCutoff} />
          <ViewMenu label="Rating" value={rating} groups={[ratings]} onChange={setRating} />
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
