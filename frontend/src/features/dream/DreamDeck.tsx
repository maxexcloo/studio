import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActionIcon, Badge, Button, Group, Text, Tooltip } from "@mantine/core";
import { Clapperboard, Copy, Heart, Star, X } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { post } from "../../api";
import type { MediaItem } from "../../types";
import { useGenerationActions } from "../generation/GenerationProvider";
import { mediaDraft } from "../gallery/useMediaAction";
import { mediaSource } from "../gallery/mediaSource";
import { queueQuery } from "../generation/Queue";
import { deckCards, type DeckCard } from "./deck";
import { PairCard, type Choose } from "./PairCard";
import { calibrationQuery, dreamItemPath, dreamQuery, type DreamItem } from "./queries";
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
// Calibration joins in once Dream has fewer unseen results than this.
const few = 6;

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
function usePrefetch(card?: DeckCard) {
  useEffect(() => {
    if (!card) return;
    for (const item of card.kind === "pair" ? card.items : [card.item]) {
      const source = mediaSource(item);
      new Image().src = item.type === "video" ? source.thumbnailUrl || "" : source.url;
    }
  }, [card]);
}

/**
 * Gallery images for calibration, drawn a round at a time while `wanted`; a new round is drawn
 * once every image so far is judged, until a round brings nothing new.
 */
function useCalibration(wanted: boolean, decided: Set<string>) {
  const [round, setRound] = useState(0);
  const query = useQuery({ ...calibrationQuery(round), enabled: wanted });
  const known = useRef(new Set<string>());
  const [pool, setPool] = useState<{ items: MediaItem[]; added: number }>({ items: [], added: 0 });
  useEffect(() => {
    if (!query.data) return;
    const fresh = query.data.items.filter((item) => !known.current.has(item.id));
    for (const item of fresh) known.current.add(item.id);
    setPool((previous) => ({ items: [...previous.items, ...fresh], added: fresh.length }));
  }, [query.data]);
  const remaining = pool.items.filter((item) => !decided.has(item.id));
  const drained = wanted && pool.added > 0 && !remaining.length;
  useEffect(() => {
    if (drained) setRound((previous) => previous + 1);
  }, [drained]);
  return remaining;
}

type Judgement =
  | { card: Extract<DeckCard, { kind: "dream" }>; verdict: Verdict }
  | { card: Extract<DeckCard, { kind: "calibration" }>; verdict: Verdict }
  | { card: Extract<DeckCard, { kind: "pair" }>; verdict: 0 | 1 };

/** Sends a verdict: Dream results move to the gallery or discards; gallery images only teach. */
function useJudge(onFailed: (card: DeckCard) => void) {
  const client = useQueryClient();
  const navigate = useNavigate();
  const { profiles, setDraft } = useGenerationActions();
  const star = (item: MediaItem) =>
    post("/api/gallery/favorite", { ids: [item.id], favorite: true });
  return useMutation({
    mutationFn: async (judgement: Judgement) => {
      if (judgement.card.kind === "pair") {
        const [first, second] = judgement.card.items;
        const [liked, passed] = judgement.verdict ? [second, first] : [first, second];
        return post("/api/dream/calibration", { liked: [liked.id], passed: [passed.id] });
      }
      const { item } = judgement.card;
      const verdict = judgement.verdict as Verdict;
      if (judgement.card.kind === "calibration") {
        if (verdict === "star") await star(item);
        return post(
          "/api/dream/calibration",
          verdict === "discard" ? { passed: [item.id] } : { liked: [item.id] },
        );
      }
      if (verdict === "discard") return post(dreamItemPath(item, "discard"));
      if (verdict === "variations") {
        await post(dreamItemPath(item, "variations"));
        return client.invalidateQueries({ queryKey: queueQuery.queryKey });
      }
      await post(dreamItemPath(item, "keep"));
      if (verdict === "star") await star(item);
      if (verdict === "animate") {
        // As the viewer's Animate in Composer, staged in the Videos composer for review.
        const { draft } = await mediaDraft(item, "animate", profiles, client);
        setDraft(draft);
        navigate("/video?compose=1");
      }
    },
    onError: (_error, { card }) => onFailed(card),
    onSettled: () =>
      Promise.all(
        [dreamQuery.queryKey, ["gallery"], ["gallery-filters"]].map((queryKey) =>
          client.invalidateQueries({ queryKey }),
        ),
      ),
  });
}

const ids = (card: DeckCard) =>
  card.kind === "pair" ? card.items.map((item) => item.id) : [card.item.id];

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
 * With `calibrate`, older gallery images join in (see `deckCards`) to teach the taste profile;
 * judging them changes nothing in the gallery beyond an optional Star. `empty` shows once the
 * deck is through, told whether calibration images are available.
 */
export function DreamDeck({
  items,
  calibrate,
  empty,
}: {
  items: DreamItem[];
  calibrate: boolean;
  empty: (calibration: boolean) => ReactNode;
}) {
  const [decided, setDecided] = useState<Set<string>>(() => new Set());
  const [counts, setCounts] = useState({ judged: 0, calibrated: 0 });
  const judge = useJudge((card) =>
    setDecided((previous) => {
      const next = new Set(previous);
      for (const id of ids(card)) next.delete(id);
      return next;
    }),
  );
  const unseen = items.filter((item) => !decided.has(item.id));
  const gallery = useCalibration(unseen.length < few, decided);
  const cards = deckCards(unseen, calibrate ? gallery : [], counts);
  const [top, next] = cards;
  usePrefetch(cards[2]);
  const fly = useRef<Fly | null>(null);
  const choose = useRef<Choose | null>(null);
  const busy = useRef(false);
  const single = top?.kind === "pair" ? undefined : top;
  const image = single?.item.type === "image";
  const dream = single?.kind === "dream";

  function commit(judgement: Judgement) {
    const card = judgement.card;
    setDecided((previous) => {
      const next = new Set(previous);
      for (const id of ids(card)) next.add(id);
      return next;
    });
    setCounts((previous) => ({
      judged: previous.judged + 1,
      calibrated: previous.calibrated + (card.kind === "dream" ? 0 : 1),
    }));
    judge.mutate(judgement);
  }
  /** Skips a pair without a choice. */
  function skip() {
    if (top?.kind !== "pair") return;
    setDecided((previous) => new Set([...previous, ...ids(top)]));
    setCounts((previous) => ({
      judged: previous.judged + 1,
      calibrated: previous.calibrated + 1,
    }));
  }
  async function act(choice: Verdict) {
    if (!top || busy.current) return;
    busy.current = true;
    try {
      if (top.kind === "pair") {
        if (choice !== "discard" && choice !== "keep") return;
        const index = choice === "discard" ? 0 : 1;
        await choose.current?.(index);
        return commit({ card: top, verdict: index });
      }
      if ((choice === "variations" || choice === "animate") && !(image && dream)) return;
      await fly.current?.(directions[choice]);
      commit({ card: top, verdict: choice } as Judgement);
    } finally {
      busy.current = false;
    }
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

  if (!top) return empty(gallery.length > 0);
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
        disabled={options.disabled}
        onClick={() => void act(choice)}
      >
        {icon}
      </ActionIcon>
    </Tooltip>
  );
  const calibrating = top.kind !== "dream";
  return (
    <>
      <div className={classes.stage}>
        {top.kind === "pair" ? (
          <PairCard
            key={top.key}
            items={top.items}
            choose={choose}
            onChoose={(index) => commit({ card: top, verdict: index })}
          />
        ) : (
          [next?.kind === "pair" ? undefined : next, top].map(
            (card) =>
              card && (
                <SwipeCard
                  key={card.key}
                  depth={card === top ? 0 : 1}
                  up={card.kind === "dream" && card.item.type === "image"}
                  fly={fly}
                  label={
                    card.kind === "dream"
                      ? card === top
                        ? "Current Dream"
                        : "Next Dream"
                      : card === top
                        ? "Current Gallery Image"
                        : "Next Gallery Image"
                  }
                  hints={card.kind === "dream" ? undefined : { keep: "Like", discard: "Pass" }}
                  onSwipe={(direction) =>
                    commit({
                      card,
                      verdict:
                        direction === "left"
                          ? "discard"
                          : direction === "up"
                            ? "variations"
                            : "keep",
                    } as Judgement)
                  }
                >
                  <div className={classes.media}>
                    <Media item={card.item} playing={card === top} />
                    {card.kind === "calibration" && (
                      <Badge className={classes.label} variant="default">
                        From Your Gallery
                      </Badge>
                    )}
                  </div>
                  {card.kind === "dream" ? (
                    <Caption item={card.item} />
                  ) : (
                    <div className={classes.caption}>
                      <Text size="xs" c="dimmed" lineClamp={2}>
                        {card.item.prompt}
                      </Text>
                    </div>
                  )}
                </SwipeCard>
              ),
          )
        )}
      </div>
      <Group className={classes.actions} justify="center" gap="md" wrap="nowrap" h={60}>
        {top.kind === "pair" ? (
          <Button variant="default" radius="xl" onClick={skip}>
            Skip
          </Button>
        ) : (
          <>
            {button("discard", calibrating ? "Pass" : "Discard", <X size={26} />, {
              size: 60,
              color: "red.5",
            })}
            {button("star", "Star", <Star size={20} />)}
            {button("animate", "Animate", <Clapperboard size={20} />, {
              disabled: !(image && dream),
            })}
            {button("variations", "Keep & Variations", <Copy size={20} />, {
              disabled: !(image && dream),
            })}
            {button("keep", calibrating ? "Like" : "Keep", <Heart size={26} />, {
              size: 60,
              color: "green.5",
            })}
          </>
        )}
      </Group>
    </>
  );
}
