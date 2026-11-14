import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Center, Loader, Stack, Text } from "@mantine/core";
import type { UseInfiniteQueryResult } from "@tanstack/react-query";

/**
 * Loads a listing's next page as its end nears `root`'s view (the window's without one), keeping
 * the pages loaded. A page that fails stops the loading and offers Retry until `results`, the
 * listing's search and filters, changes. Nothing loads while `paused`.
 */
export function MorePages({
  listing,
  results,
  root = null,
  paused = false,
}: {
  listing: UseInfiniteQueryResult;
  results: string;
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
  const { hasNextPage, isFetching, isFetchNextPageError, dataUpdatedAt, fetchNextPage } = listing;
  const more = useCallback(
    () =>
      void fetchNextPage({ cancelRefetch: false }).then((result) =>
        setFailed(result.isFetchNextPageError),
      ),
    [fetchNextPage],
  );
  useEffect(() => {
    const element = trigger.current;
    if (!element) return;
    const observer = new IntersectionObserver(
      (entries) => setNear(entries[entries.length - 1].isIntersecting),
      { root, rootMargin: "800px" },
    );
    observer.observe(element);
    return () => {
      observer.disconnect();
      setNear(false);
    };
  }, [hasNextPage, root]);
  // Each loaded page checks again: a quick page's fetching and fetched states can reach one render.
  useEffect(() => {
    if (near && hasNextPage && !isFetching && !failed && !isFetchNextPageError && !paused) more();
  }, [near, hasNextPage, isFetching, isFetchNextPageError, failed, more, paused, dataUpdatedAt]);
  if (!hasNextPage) return null;
  return (
    <Center ref={trigger} mih={44}>
      {failed ? (
        <Stack gap={4} align="center">
          <Text size="sm" c="dimmed">
            More results couldn’t be loaded.
          </Text>
          <Button variant="default" radius="xl" loading={listing.isFetchingNextPage} onClick={more}>
            Retry
          </Button>
        </Stack>
      ) : (
        listing.isFetchingNextPage && <Loader size="sm" color="gray" aria-label="Loading More" />
      )}
    </Center>
  );
}
