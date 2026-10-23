import { useEffect, useState } from "react";
import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Loader,
  Paper,
  Stack,
  Switch,
  Text,
  TextInput,
  Title,
  VisuallyHidden,
} from "@mantine/core";
import { Search } from "lucide-react";
import { useDebouncedValue, useDisclosure } from "@mantine/hooks";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router";
import { useGeneration } from "../generation/GenerationProvider";
import { api } from "../../api";
import type { MediaItem } from "../../types";
import { MediaGrid } from "./MediaGrid";
import { MediaViewer } from "./MediaViewer";
import { QueueActivity } from "../generation/QueueActivity";
import { ComposerDock } from "../generation/ComposerDock";
interface Page {
  items: MediaItem[];
  nextCursor: string;
  hasMore: boolean;
}
export function GalleryPage() {
  const [searchOpen, { toggle: toggleSearch }] = useDisclosure(false);
  const [query, setQuery] = useState("");
  const [search] = useDebouncedValue(query, 250);
  const [params] = useSearchParams();
  const kind = params.get("type") === "video" ? "video" : "image";
  const { profiles, selectProfile, input } = useGeneration();
  useEffect(() => {
    if (input.kind !== kind) {
      const next = profiles.find((profile) => profile.kind === kind);
      if (next) selectProfile(next);
    }
  }, [kind, profiles]);
  const [starred, setStarred] = useState(false);
  const [selected, setSelected] = useState<MediaItem | null>(null);
  const gallery = useInfiniteQuery({
    queryKey: ["gallery", search, kind, starred],
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      api<Page>(
        `/api/gallery?${new URLSearchParams({ limit: "60", cursor: pageParam, q: search, type: kind || "", favorites: starred ? "1" : "0" })}`,
      ),
    getNextPageParam: (last) => (last.hasMore ? last.nextCursor : undefined),
    refetchInterval: 3000,
  });
  const items = gallery.data?.pages.flatMap((page) => page.items) || [];
  return (
    <Stack gap="xl" className="studio-gallery-page">
      <VisuallyHidden component="h1">{kind === "video" ? "Videos" : "Images"}</VisuallyHidden>
      <Group>
        <ActionIcon
          aria-label="Search Gallery"
          aria-expanded={searchOpen}
          onClick={toggleSearch}
          variant={searchOpen || query ? "light" : "default"}
          size="xl"
          radius="xl"
        >
          <Search size={18} />
        </ActionIcon>
        {searchOpen && (
          <TextInput
            aria-label="Search Gallery"
            placeholder="Search your generations…"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            style={{ flex: 1, minWidth: 180 }}
          />
        )}
        <QueueActivity />
        <Switch
          label="Starred"
          checked={starred}
          onChange={(e) => setStarred(e.currentTarget.checked)}
        />
      </Group>
      {gallery.isPending ? (
        <Loader aria-label="Loading Gallery" />
      ) : gallery.error ? (
        <Alert color="red" title="Couldn’t Load the Gallery">
          {gallery.error.message}
          <Button variant="subtle" onClick={() => void gallery.refetch()}>
            Try Again
          </Button>
        </Alert>
      ) : items.length ? (
        <MediaGrid items={items} open={setSelected} />
      ) : (
        <Paper py={70}>
          <Stack align="center">
            <Title order={3}>
              {search || starred ? "No Matching Results" : "Make Something Yours"}
            </Title>
            <Text c="dimmed" ta="center">
              {search || starred
                ? "Try another search or clear your filters."
                : "Start with an image. Refine the details, then bring it to life."}
            </Text>
            <Button component={Link} to={`/?type=${kind}&compose=1`}>
              Create an Image
            </Button>
          </Stack>
        </Paper>
      )}
      {gallery.hasNextPage && (
        <Button
          variant="default"
          loading={gallery.isFetchingNextPage}
          onClick={() => void gallery.fetchNextPage()}
        >
          Load More
        </Button>
      )}
      <ComposerDock />
      {selected && (
        <MediaViewer
          item={items.find((i) => i.id === selected.id) || selected}
          close={() => setSelected(null)}
        />
      )}
    </Stack>
  );
}
