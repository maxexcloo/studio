import { useEffect, useRef, useState } from "react";
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
  const { hasNextPage, isFetching, isFetchNextPageError, fetchNextPage } = listing;
  const more = () => void fetchNextPage().then((result) => setFailed(result.isFetchNextPageError));
  useEffect(() => {
    const element = trigger.current;
    if (!element || !hasNextPage || isFetching || failed || isFetchNextPageError || paused) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          void fetchNextPage().then((result) => setFailed(result.isFetchNextPageError));
        }
      },
      { root, rootMargin: "800px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasNextPage, isFetching, isFetchNextPageError, failed, fetchNextPage, paused, root]);
  if (!hasNextPage) return null;
  return (
    <Center mih={44}>
      <div ref={trigger} aria-hidden="true" />
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
