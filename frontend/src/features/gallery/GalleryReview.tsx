import { Alert, Button, Group, Modal, Select, Stack } from "@mantine/core";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useId, useState } from "react";

import type { MediaItem } from "../../types";
import { EmptyState } from "../../ui/EmptyState";
import { closeWhenTop } from "../../ui/popupClicks";
import { usePhone } from "../../ui/usePhone";
import { DreamDeck, type Judgement } from "../dream/DreamDeck";
import { type GalleryListing, type GalleryReviewRating, galleryReviewQuery } from "./queries";

const day = 24 * 60 * 60 * 1000;
const ratings = [
  { value: "unrated", label: "Unrated" },
  { value: "liked", label: "Liked" },
  { value: "disliked", label: "Disliked" },
  { value: "all", label: "All Ratings" },
];

export function GalleryReview({
  listing,
  leftAt,
  close,
}: {
  listing: GalleryListing;
  leftAt: number;
  close: () => void;
}) {
  const id = useId();
  const phone = usePhone();
  const [openedAt] = useState(Date.now);
  const [cutoff, setCutoff] = useState("0");
  const [rating, setRating] = useState<GalleryReviewRating>(listing.filters.rating || "unrated");
  const times = [
    { value: "0", label: "Any Time" },
    { value: String(openedAt - day), label: "Last 24 Hours" },
    { value: String(openedAt - 7 * day), label: "Last 7 Days" },
    ...(leftAt ? [{ value: String(leftAt + 1), label: "New Since Last Gallery Visit" }] : []),
  ];
  return (
    <Modal
      id={id}
      opened
      onClose={closeWhenTop(id, close)}
      title="Review Gallery"
      fullScreen={phone}
      size="min(90vw, 72rem)"
    >
      <Stack gap="xs" h={phone ? "100%" : "min(80dvh, 64rem)"}>
        <Group gap="xs" grow wrap="nowrap">
          <Select
            aria-label="Review Time"
            data={times}
            value={cutoff}
            allowDeselect={false}
            onChange={(value) => setCutoff(value ?? "0")}
          />
          <Select
            aria-label="Review Rating"
            data={ratings}
            value={rating}
            allowDeselect={false}
            onChange={(value) => setRating((value ?? "unrated") as GalleryReviewRating)}
          />
        </Group>
        <GalleryReviewDeck
          key={`${rating}:${cutoff}`}
          listing={listing}
          rating={rating}
          since={Number(cutoff)}
          close={close}
        />
      </Stack>
    </Modal>
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
