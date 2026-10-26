import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActionIcon, Group, Text, Tooltip } from "@mantine/core";
import { Clapperboard, Copy, Heart, Star, X } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { post } from "../../api";
import type { MediaItem } from "../../types";
import { useGenerationActions } from "../generation/GenerationProvider";
import { mediaDraft } from "../gallery/useMediaAction";
import { mediaSource } from "../gallery/mediaSource";
import { queueQuery } from "../generation/Queue";
import { dreamItemPath, dreamQuery, type DreamItem } from "./queries";
import { SwipeCard, type Direction, type Fly } from "./SwipeCard";
import classes from "./DreamPage.module.css";

export type Verdict = "discard" | "keep" | "variations" | "star" | "animate";
const directions: Record<Verdict, Direction> = {
  discard: "left",
  keep: "right",
  variations: "up",
  star: "right",
  animate: "right",
};
const layers =
  '[role="dialog"], [role="alertdialog"], .mantine-Popover-dropdown, .mantine-Combobox-dropdown, .mantine-Menu-dropdown';

/** The card's media: the top card plays a video; cards beneath show its still. */
function Media({ item, playing }: { item: MediaItem; playing: boolean }) {
  const source = mediaSource(item);
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  if (item.type === "video" && playing)
    return (
      <video
        src={source.url}
        poster={source.thumbnailUrl}
        autoPlay
        muted
        loop
        playsInline
        aria-label={item.prompt || "Dream video"}
      />
    );
  return (
    <img
      src={item.type === "video" ? source.thumbnailUrl || source.url : source.url}
      alt={item.prompt || "Dream image"}
      draggable={false}
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

/** Warms the browser cache for a card that is not on screen yet. */
function usePrefetch(item?: MediaItem) {
  useEffect(() => {
    if (!item) return;
    const source = mediaSource(item);
    const image = new Image();
    image.src = item.type === "video" ? source.thumbnailUrl || "" : source.url;
  }, [item]);
}

/** Judges one Dream result: keeps, discards, varies, stars or animates it. */
function useVerdict(onFailed: (item: DreamItem) => void) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { profiles, setDraft } = useGenerationActions();
  return useMutation({
    mutationFn: async ({ item, verdict }: { item: DreamItem; verdict: Verdict }) => {
      if (verdict === "discard") return post(dreamItemPath(item, "discard"));
      if (verdict === "variations") {
        await post(dreamItemPath(item, "variations"));
        return client.invalidateQueries({ queryKey: queueQuery.queryKey });
      }
      // Starring an unseen result keeps it (backend/domain/dream.ts).
      if (verdict === "star")
        return post("/api/gallery/favorite", { ids: [item.id], favorite: true });
      await post(dreamItemPath(item, "keep"));
      if (verdict === "animate") {
        // As the viewer's Animate in Composer, staged in the Videos composer for review.
        const { draft } = await mediaDraft(item, "animate", profiles, client);
        setDraft(draft);
        navigate("/video?compose=1");
      }
    },
    onError: (_error, { item }) => onFailed(item),
    onSettled: () =>
      Promise.all(
        [dreamQuery.queryKey, ["gallery"], ["gallery-filters"]].map((queryKey) =>
          client.invalidateQueries({ queryKey }),
        ),
      ),
  });
}

function Caption({ item }: { item: DreamItem }) {
  return (
    <div className={classes.caption}>
      {item.dream?.why && (
        <Text size="sm" fw={500} lineClamp={1}>
          {item.dream.why}
        </Text>
      )}
      <Text size="xs" c="dimmed" lineClamp={2}>
        {item.prompt || item.dream?.prompt}
      </Text>
    </div>
  );
}

/**
 * The Dream deck: the oldest unseen result on top, the next beneath it. Swipe or press ← to
 * discard, → to keep, ↑ to keep and queue variations; Star and Animate keep the result too.
 */
export function DreamDeck({ items, empty }: { items: DreamItem[]; empty: ReactNode }) {
  const [decided, setDecided] = useState<Set<string>>(() => new Set());
  const verdict = useVerdict((item) =>
    setDecided((previous) => {
      const next = new Set(previous);
      next.delete(item.id);
      return next;
    }),
  );
  const fly = useRef<Fly | null>(null);
  const busy = useRef(false);
  const deck = items.filter((item) => !decided.has(item.id));
  const [top, next] = deck;
  usePrefetch(deck[2]);
  const varies = top?.type === "image";

  function commit(item: DreamItem, choice: Verdict) {
    setDecided((previous) => new Set(previous).add(item.id));
    verdict.mutate({ item, verdict: choice });
  }
  async function act(choice: Verdict) {
    if (!top || busy.current || (choice === "variations" && !varies)) return;
    if (choice === "animate" && top.type !== "image") return;
    busy.current = true;
    await fly.current?.(directions[choice]);
    busy.current = false;
    commit(top, choice);
  }
  const actRef = useRef(act);
  actRef.current = act;
  useEffect(() => {
    const keys: Record<string, Verdict> = {
      ArrowLeft: "discard",
      ArrowRight: "keep",
      ArrowUp: "variations",
    };
    function onKey(event: KeyboardEvent) {
      const choice = keys[event.key];
      if (!choice || event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey)
        return;
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable='true']")) return;
      if (
        [...document.querySelectorAll<HTMLElement>(layers)].some(
          (layer) => layer.getClientRects().length,
        )
      )
        return;
      event.preventDefault();
      void actRef.current(choice);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const button = (
    choice: Verdict,
    label: string,
    icon: ReactNode,
    options: { size?: number; color?: string; disabled?: boolean } = {},
  ) => (
    <Tooltip label={label}>
      <ActionIcon
        variant="default"
        radius="xl"
        size={options.size ?? 48}
        c={options.color}
        aria-label={label}
        disabled={!top || options.disabled}
        onClick={() => void act(choice)}
      >
        {icon}
      </ActionIcon>
    </Tooltip>
  );
  if (!top) return empty;
  return (
    <>
      <div className={classes.stage}>
        {[next, top].map(
          (item) =>
            item && (
              <SwipeCard
                key={item.id}
                depth={item === top ? 0 : 1}
                up={item.type === "image"}
                fly={fly}
                label={item === top ? "Current Dream" : "Next Dream"}
                onSwipe={(direction) =>
                  commit(
                    item,
                    direction === "left" ? "discard" : direction === "up" ? "variations" : "keep",
                  )
                }
              >
                <div className={classes.media}>
                  <Media item={item} playing={item === top} />
                </div>
                <Caption item={item} />
              </SwipeCard>
            ),
        )}
      </div>
      <Group className={classes.actions} justify="center" gap="md" wrap="nowrap">
        {button("discard", "Discard", <X size={26} />, { size: 60, color: "red.5" })}
        {button("star", "Star", <Star size={20} />)}
        {button("animate", "Animate", <Clapperboard size={20} />, {
          disabled: top?.type !== "image",
        })}
        {button("variations", "Keep & Variations", <Copy size={20} />, { disabled: !varies })}
        {button("keep", "Keep", <Heart size={26} />, { size: 60, color: "green.5" })}
      </Group>
    </>
  );
}
