import {
  Alert,
  AspectRatio,
  Button,
  Card,
  Center,
  ScrollArea,
  SimpleGrid,
  Text,
} from "@mantine/core";
import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Heart } from "lucide-react";
import { useState } from "react";
import { post } from "../../api";
import { EmptyState } from "../../ui/EmptyState";
import { LoadingState } from "../../ui/LoadingState";
import { mediaSource } from "../gallery/mediaSource";
import { discardedQuery, dreamItemPath, dreamQuery, type DreamItem } from "./queries";
import classes from "./DreamPage.module.css";

function Thumbnail({ item }: { item: DreamItem }) {
  const source = mediaSource(item);
  const [failed, setFailed] = useState(false);
  return failed ? null : (
    <img
      className={classes.thumb}
      src={source.thumbnailUrl || source.url}
      alt={item.prompt || "Discarded Dream"}
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

/** Discarded Dream results, newest discard first; Keep moves one into the gallery after all. */
export function DiscardedDreams() {
  const client = useQueryClient();
  const discarded = useInfiniteQuery(discardedQuery);
  const keep = useMutation({
    mutationFn: (item: DreamItem) => post(dreamItemPath(item, "keep")),
    onSettled: () =>
      Promise.all(
        [dreamQuery.queryKey, ["gallery"], ["gallery-filters"]].map((queryKey) =>
          client.invalidateQueries({ queryKey }),
        ),
      ),
  });
  if (discarded.isPending) return <LoadingState fill label="Loading Discards" />;
  if (discarded.isError)
    return (
      <Alert color="red" title="Couldn’t Load Discards">
        {discarded.error.message}
      </Alert>
    );
  const items = discarded.data.pages.flatMap((page) => page.items);
  if (!items.length)
    return (
      <EmptyState fill title="No Discards">
        Results you discard stay here, so you can keep one after all.
      </EmptyState>
    );
  return (
    <ScrollArea flex={1} mih={0} type="auto">
      <SimpleGrid cols={{ base: 2, sm: 3, md: 5, lg: 6 }} spacing="sm" pb="md">
        {items.map((item) => (
          <Card key={item.id} withBorder padding={0} radius="md">
            <AspectRatio ratio={1}>
              <Thumbnail item={item} />
            </AspectRatio>
            <Text size="xs" c="dimmed" lineClamp={2} px="xs" pt={6} mih={36}>
              {item.prompt || item.dream?.prompt}
            </Text>
            <Button
              m="xs"
              size="xs"
              variant="light"
              leftSection={<Heart size={14} />}
              loading={keep.isPending && keep.variables?.id === item.id}
              onClick={() => keep.mutate(item)}
              aria-label={`Keep ${item.prompt || "Result"}`}
            >
              Keep
            </Button>
          </Card>
        ))}
      </SimpleGrid>
      {discarded.hasNextPage && (
        <Center pb="md">
          <Button
            variant="default"
            size="sm"
            loading={discarded.isFetchingNextPage}
            onClick={() => void discarded.fetchNextPage()}
          >
            {discarded.isFetchNextPageError ? "Retry Loading" : "Load More"}
          </Button>
        </Center>
      )}
    </ScrollArea>
  );
}
