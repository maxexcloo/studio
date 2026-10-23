import { useEffect, useRef, useState } from "react";
import { Accordion, Button, Group, Modal, Stack, Text, Title } from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { notifications } from "@mantine/notifications";
import { api, failure } from "../../api";
import type { MediaItem } from "../../types";
import { copyText } from "../../ui/clipboard";
import { MediaComparison } from "./MediaComparison";
import { useMediaAction } from "./useMediaAction";

export function MediaViewer({
  item,
  close,
  sessionId,
}: {
  item: MediaItem;
  close: () => void;
  sessionId?: string;
}) {
  const client = useQueryClient();
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const media = video.current;
    const pause = () => {
      if (document.hidden) media?.pause();
    };
    document.addEventListener("visibilitychange", pause);
    return () => {
      document.removeEventListener("visibilitychange", pause);
      if (media) {
        media.pause();
        media.removeAttribute("src");
        media.load();
      }
    };
  }, []);
  const [compare, setCompare] = useState(false);
  const action = useMediaAction(item, sessionId, close);
  const mutate = useMutation({
    mutationFn: ({ path, body, method }: { path: string; body?: unknown; method?: string }) =>
      api(path, { method: method || "POST", body: body ? JSON.stringify(body) : undefined }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ["gallery"] });
    },
    onError: failure,
  });
  return (
    <Modal
      opened
      onClose={close}
      title={(item.settings?.profileName as string) || "Generation"}
      closeButtonProps={{ "aria-label": "Close Generation" }}
      size="xl"
      centered
    >
      <Stack>
        {item.type === "video" ? (
          <video
            ref={video}
            key={item.id}
            src={item.url}
            controls
            autoPlay={false}
            playsInline
            className="studio-viewer"
          />
        ) : compare && item.upscale?.url ? (
          <MediaComparison
            original={item.url}
            upscale={item.upscale.url}
            width={item.width}
            height={item.height}
          />
        ) : (
          <img
            className="studio-viewer"
            src={item.upscale?.url || item.url}
            alt={item.prompt || "Generated Image"}
            width={item.width}
            height={item.height}
            onError={(event) => {
              event.currentTarget.hidden = true;
            }}
          />
        )}
        <Group gap="xs">
          <Button
            component="a"
            href={`/api/gallery/export?ids=${encodeURIComponent(item.id)}`}
            variant="default"
            size="sm"
          >
            Download
          </Button>
          <Button
            variant="default"
            size="sm"
            onClick={() => {
              void copyText(item.prompt || "")
                .then(() => notifications.show({ message: "Prompt copied" }))
                .catch(failure);
            }}
          >
            Copy Prompt
          </Button>
          <Button
            variant="default"
            size="sm"
            loading={action.isPending}
            onClick={() => action.mutate("image")}
          >
            Recreate
          </Button>
          <Button
            size="sm"
            loading={action.isPending}
            onClick={() => action.mutate(item.type === "video" ? "extend" : "refine")}
          >
            {item.type === "video" ? "Extend" : "Refine"}
          </Button>
          {item.type === "image" && (
            <Button
              size="sm"
              variant="light"
              loading={action.isPending}
              onClick={() => action.mutate("animate")}
            >
              Animate
            </Button>
          )}
        </Group>
        <Group gap="xs">
          <Button
            variant="subtle"
            size="sm"
            onClick={() =>
              mutate.mutate({
                path: "/api/gallery/favorite",
                body: { ids: [item.id], favorite: !item.favorite },
              })
            }
          >
            {item.favorite ? "Unstar" : "Star"}
          </Button>
          {item.type === "image" && (
            <Button
              variant="subtle"
              size="sm"
              onClick={() =>
                mutate.mutate({
                  path: "/api/upscale",
                  body: { galleryItemId: item.id, quality: "balanced" },
                })
              }
            >
              Upscale
            </Button>
          )}
          {item.upscale?.url && (
            <Button
              variant="subtle"
              size="sm"
              onClick={() => {
                setCompare(!compare);
              }}
            >
              {compare ? "Close Comparison" : "Compare"}
            </Button>
          )}
          <Button
            color="red"
            variant="subtle"
            size="sm"
            onClick={() => {
              mutate.mutate({
                path: `/api/gallery/${encodeURIComponent(item.id)}`,
                method: "DELETE",
              });
              close();
            }}
          >
            Delete
          </Button>
        </Group>
        <Accordion>
          <Accordion.Item value="details">
            <Accordion.Control>Generation Details</Accordion.Control>
            <Accordion.Panel>
              <Stack gap="sm">
                <Title order={5}>Prompt</Title>
                <Text style={{ whiteSpace: "pre-wrap" }}>{item.prompt}</Text>
                {item.negative && (
                  <>
                    <Title order={5}>Negative Prompt</Title>
                    <Text>{item.negative}</Text>
                  </>
                )}
                <Title order={5}>Model & Settings</Title>
                <Text size="sm">{item.model}</Text>
                {Object.entries(item.settings || {})
                  .filter(
                    ([, value]) =>
                      typeof value === "string" ||
                      typeof value === "number" ||
                      typeof value === "boolean",
                  )
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([key, value]) => (
                    <Group key={key} justify="space-between">
                      <Text size="sm" c="dimmed">
                        {key}
                      </Text>
                      <Text size="sm" style={{ overflowWrap: "anywhere" }}>
                        {String(value)}
                      </Text>
                    </Group>
                  ))}
                <Text size="xs" c="dimmed">
                  {item.createdAt}
                </Text>
              </Stack>
            </Accordion.Panel>
          </Accordion.Item>
        </Accordion>
      </Stack>
    </Modal>
  );
}
