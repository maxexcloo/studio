import {
  Alert,
  Button,
  FileButton,
  Group,
  Image,
  Loader,
  Modal,
  Pill,
  SimpleGrid,
  Stack,
  Tabs,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "../../api";
import type { MediaItem } from "../../types";
import { useGeneration } from "./GenerationProvider";
import { useGalleryReference } from "./references";
import { useReferenceUpload } from "./useReferenceUpload";

export function ReferencePicker({ compact = false }: { compact?: boolean }) {
  const [opened, { open, close }] = useDisclosure(false);
  const { draft, setDraft } = useGeneration();
  const select = useGalleryReference(close);
  const { upload, uploading } = useReferenceUpload();
  const gallery = useInfiniteQuery({
    queryKey: ["reference-gallery"],
    enabled: opened,
    initialPageParam: "",
    queryFn: ({ pageParam }) =>
      api<{ items: MediaItem[]; hasMore: boolean; nextCursor: string }>(
        `/api/gallery?${new URLSearchParams({ limit: "60", cursor: pageParam })}`,
      ),
    getNextPageParam: (last) => (last.hasMore ? last.nextCursor : undefined),
  });
  return (
    <>
      <Button
        aria-label="Choose References"
        variant={compact ? "subtle" : "default"}
        size="compact-sm"
        onClick={open}
        loading={select.isPending}
      >
        {compact ? (
          <>
            <span className="studio-generation-label-wide">+ Reference</span>
            <span className="studio-generation-label-narrow">+</span>
          </>
        ) : (
          "Add Reference"
        )}
      </Button>
      <Modal
        opened={opened}
        onClose={close}
        title="References"
        closeButtonProps={{ "aria-label": "Close References" }}
        size="lg"
      >
        <Stack data-composer-layer>
          {!!draft.references.length && (
            <Pill.Group>
              {draft.references.map((asset) => (
                <Pill
                  key={asset.id}
                  withRemoveButton
                  removeButtonProps={{ "aria-label": `Remove ${asset.name}` }}
                  onRemove={() =>
                    setDraft((previous) => ({
                      ...previous,
                      references: previous.references.filter(
                        (reference) => reference.id !== asset.id,
                      ),
                      input: { ...previous.input, referenceAssets: [] },
                    }))
                  }
                >
                  {asset.name}
                </Pill>
              ))}
            </Pill.Group>
          )}
          <Tabs defaultValue="gallery">
            <Tabs.List>
              <Tabs.Tab value="gallery">Gallery</Tabs.Tab>
              <Tabs.Tab value="upload">Upload</Tabs.Tab>
            </Tabs.List>
            <Tabs.Panel value="gallery" pt="md">
              {gallery.isPending ? (
                <Loader aria-label="Loading References" />
              ) : gallery.error ? (
                <Alert color="red">{gallery.error.message}</Alert>
              ) : (
                <Stack>
                  <SimpleGrid cols={{ base: 2, sm: 3 }}>
                    {gallery.data.pages
                      .flatMap((page) => page.items)
                      .filter((item) => item.status === "done")
                      .map((item) => (
                        <UnstyledButton
                          key={item.id}
                          aria-label={`Use reference: ${item.prompt || item.filename || "Result"}`}
                          onClick={() => select.mutate(item)}
                          disabled={select.isPending}
                          style={{ overflow: "hidden", borderRadius: "var(--mantine-radius-md)" }}
                        >
                          <Image
                            src={item.thumbnailUrl || item.preview || item.url}
                            alt=""
                            h={140}
                            fit="cover"
                          />
                          <Text truncate size="xs" p="xs">
                            {item.prompt || item.filename || "Result"}
                          </Text>
                        </UnstyledButton>
                      ))}
                  </SimpleGrid>
                  {gallery.data.pages.every((page) => !page.items.length) && (
                    <Text c="dimmed">
                      Saved results will appear here. You can upload a reference instead.
                    </Text>
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
                </Stack>
              )}
            </Tabs.Panel>
            <Tabs.Panel value="upload" pt="md">
              <Stack>
                <Text c="dimmed" size="sm">
                  Choose an image from your device.
                </Text>
                <FileButton
                  accept="image/*"
                  onChange={async (file) => {
                    const asset = await upload(file);
                    if (asset) close();
                  }}
                >
                  {(props) => (
                    <Button {...props} loading={uploading}>
                      Upload Reference
                    </Button>
                  )}
                </FileButton>
              </Stack>
            </Tabs.Panel>
          </Tabs>
        </Stack>
      </Modal>
    </>
  );
}
