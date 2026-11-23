import { Button, Center, Loader, Stack, Text } from "@mantine/core";
import type { UseInfiniteQueryResult } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Loads a neighbouring page as the listing's edge nears `root`'s view (the window's without one), keeping
 * the pages loaded. A page that fails stops the loading and offers Retry until `results`, the
 * listing's search and filters, changes. Nothing loads while `paused`.
 */
export function MorePages({
  listing,
  results,
  direction = "next",
  root = null,
  paused = false,
}: {
  listing: UseInfiniteQueryResult;
  results: string;
  direction?: "next" | "previous";
  root?: Element | null;
  paused?: boolean;
}) {
  const trigger = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  const [failedFor, setFailedFor] = useState(results);
  if (failedFor !== results) {
    setFailedFor(results);
    setFailed(false);
  }
  const [near, setNear] = useState(false);
  const { isFetching, dataUpdatedAt } = listing;
  const previous = direction === "previous";
  const pageMargin = root || previous ? 800 : 1600;
  const hasPage = previous ? listing.hasPreviousPage : listing.hasNextPage;
  const fetching = previous ? listing.isFetchingPreviousPage : listing.isFetchingNextPage;
  const fetchError = previous ? listing.isFetchPreviousPageError : listing.isFetchNextPageError;
  const fetchPage = previous ? listing.fetchPreviousPage : listing.fetchNextPage;
  const more = useCallback(
    () =>
      void fetchPage({ cancelRefetch: false }).then((result) =>
        setFailed(previous ? result.isFetchPreviousPageError : result.isFetchNextPageError),
      ),
    [fetchPage, previous],
  );
  useEffect(() => {
    const element = trigger.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => setNear(entries[entries.length - 1].isIntersecting),
      { root, rootMargin: `${pageMargin}px` },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      setNear(false);
    };
  }, [hasPage, pageMargin, root]);
  // Each loaded page checks again: a quick page's fetching and fetched states can reach one render.
  useEffect(() => {
    if (!near || !hasPage || isFetching || failed || fetchError || paused) return;
    // Prepending holds the current tile in place and moves the trigger away before the observer runs.
    if (
      previous &&
      trigger.current &&
      trigger.current.getBoundingClientRect().bottom <
        (root?.getBoundingClientRect().top ?? 0) - pageMargin
    )
      return;
    more();
  }, [
    near,
    hasPage,
    isFetching,
    fetchError,
    failed,
    more,
    paused,
    dataUpdatedAt,
    pageMargin,
    previous,
    root,
  ]);
  if (!hasPage) return null;
  return (
    <Center ref={trigger} mih={44}>
      {failed || fetchError ? (
        <Stack gap={4} align="center">
          <Text size="sm" c="dimmed">
            More results couldn't be loaded.
          </Text>
          <Button variant="default" radius="xl" loading={fetching} onClick={more}>
            Retry
          </Button>
        </Stack>
      ) : (
        fetching && <Loader size="sm" color="gray" aria-label="Loading More" />
      )}
    </Center>
  );
}
