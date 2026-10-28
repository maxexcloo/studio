import { useEffect, useRef, useState, type ReactNode } from "react";
import { ActionIcon, Badge, Button, Group, Text, Tooltip } from "@mantine/core";
import { usePhone } from "../../ui/usePhone";
import { Clapperboard, Heart, Layers, Maximize2, Star, WandSparkles, X } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { post } from "../../api";
import type { MediaItem } from "../../types";
import { useGenerationActions } from "../generation/GenerationProvider";
import { MediaViewer } from "../gallery/MediaViewer";
import { mediaDraft } from "../gallery/useMediaAction";
import { mediaSource } from "../gallery/mediaSource";
import { queueQuery } from "../generation/Queue";
import { deckCards, type DeckCard, type PairDeckCard } from "./deck";
import { PairContent, sideNames } from "./PairCard";
import {
  calibrationQuery,
  dreamItemPath,
  dreamQuery,
  pairAnswerPath,
  type DreamItem,
  type PairAnswer,
} from "./queries";
import { SwipeCard, type Direction, type Fly } from "./SwipeCard";
import { popupLayer } from "../../ui/popupClicks";
import classes from "./DreamPage.module.css";

type Verdict = "discard" | "keep" | "variations" | "star" | "animate" | "refine" | "more";
type SingleCard = Exclude<DeckCard, PairDeckCard>;
const directions: Record<Verdict, Direction> = {
  discard: "left",
  keep: "right",
  variations: "up",
  star: "right",
  animate: "right",
  refine: "right",
  more: "right",
};
/** A pair is answered by its direction: A left, B right, Both up and Neither down. */
const answers: Record<Direction, PairAnswer> = {
  left: "a",
  right: "b",
  up: "both",
  down: "neither",
};
const answerDirections = Object.fromEntries(
  Object.entries(answers).map(([direction, answer]) => [answer, direction]),
) as Record<PairAnswer, Direction>;
const keyDirections: Record<string, Direction> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};
const layers = `[role="dialog"], [role="alertdialog"], ${popupLayer}`;
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
  | { card: SingleCard; verdict: Verdict }
  | { card: PairDeckCard; verdict: PairAnswer };

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
        const { pairId, items } = judgement.card;
        const answer = judgement.verdict as PairAnswer;
        if (pairId) return post(pairAnswerPath(pairId), { answer });
        const [a, b] = items.map((item) => item.id);
        return post(
          "/api/dream/calibration",
          {
            a: { liked: [a], passed: [b] },
            b: { liked: [b], passed: [a] },
            both: { liked: [a, b] },
            neither: { passed: [a, b] },
          }[answer],
        );
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
      if (verdict === "more") return post(dreamItemPath(item, "more"));
      if (verdict === "variations") {
        await post(dreamItemPath(item, "variations"));
        return client.invalidateQueries({ queryKey: queueQuery.queryKey });
      }
      // Starring an unseen result keeps it (backend/domain/dream.ts).
      if (verdict === "star") return star(item);
      await post(dreamItemPath(item, "keep"));
      // As the viewer's Animate in Composer and Edit, staged in the composer for review.
      if (verdict === "animate" || verdict === "refine") {
        const { draft } = await mediaDraft(item, verdict, profiles, client);
        setDraft(draft);
        navigate(`${verdict === "animate" ? "/video" : "/images"}?compose=1`);
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
/** How many Dream results a card holds; calibration cards hold none. */
const dreamed = (card: DeckCard) =>
  card.kind === "dream" ? 1 : card.kind === "pair" && card.pairId ? 2 : 0;

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

/** The current batch as a strip: judged results filled, the current one marked, the rest to come. */
function BatchStrip({ done, total }: { done: number; total: number }) {
  if (total < 2) return null;
  return (
    <div
      className={classes.strip}
      role="progressbar"
      aria-label="Dream Batch"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={done}
      aria-valuetext={`${done + 1} of ${total}`}
    >
      {Array.from({ length: total }, (_, index) => (
        <span
          key={index}
          data-done={index < done || undefined}
          data-current={index === done || undefined}
        />
      ))}
    </div>
  );
}

const cardLabel = (card: DeckCard, top: boolean) =>
  card.kind === "pair"
    ? top
      ? card.question
      : "Next Comparison"
    : `${top ? "Current" : "Next"} ${card.kind === "dream" ? "Dream" : "Gallery Image"}`;

/**
 * The Dream deck: the oldest unseen result on top, the next beneath it, the batch's progress above.
 * Swipe or press ← to skip, → to keep, ↑ to keep and queue variations; Refine, Animate, Star and
 * More Like This in the compact bar keep the result too. A comparison asks about two results
 * alike but for one thing: ← or a left swipe answers A, → B, ↑ Both and ↓ Neither. Tapping a
 * card (or its View action) opens it in the viewer over the deck, which stays where it was.
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
  const phone = usePhone();
  const [decided, setDecided] = useState<Set<string>>(() => new Set());
  const [counts, setCounts] = useState({ judged: 0, calibrated: 0, dreamed: 0 });
  const [viewing, setViewing] = useState<{ item: MediaItem; items: MediaItem[] } | null>(null);
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
      calibrated: previous.calibrated + (dreamed(card) ? 0 : 1),
      dreamed: previous.dreamed + dreamed(card),
    }));
    judge.mutate(judgement);
  }
  /** Flies the top card out its way, then commits the verdict or answer. */
  async function act(choice: Verdict | PairAnswer) {
    if (!top || busy.current) return;
    busy.current = true;
    try {
      if (top.kind === "pair") {
        if (!(choice in answerDirections)) return;
        await fly.current?.(answerDirections[choice as PairAnswer]);
        return commit({ card: top, verdict: choice as PairAnswer });
      }
      if (!(choice in directions)) return;
      if (["variations", "animate", "refine", "more"].includes(choice) && !(image && dream)) return;
      await fly.current?.(directions[choice as Verdict]);
      commit({ card: top, verdict: choice as Verdict });
    } finally {
      busy.current = false;
    }
  }
  /** What a swipe or arrow key in a direction means for the top card. */
  const intent = (direction: Direction): Verdict | PairAnswer | null =>
    top?.kind === "pair"
      ? answers[direction]
      : ({ left: "discard", right: "keep", up: "variations", down: null } as const)[direction];
  const keyRef = useRef(intent);
  keyRef.current = intent;
  const actRef = useRef(act);
  actRef.current = act;
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const direction = keyDirections[event.key];
      if (!direction || event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey)
        return;
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable='true']")) return;
      if (
        [...document.querySelectorAll<HTMLElement>(layers)].some(
          (layer) => layer.getClientRects().length,
        )
      )
        return;
      const choice = keyRef.current(direction);
      if (!choice) return;
      event.preventDefault();
      void actRef.current(choice);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const viewer = viewing && (
    <MediaViewer
      item={viewing.items.find((item) => item.id === viewing.item.id) || viewing.item}
      items={viewing.items}
      navigate={(item) => setViewing({ ...viewing, item })}
      close={() => setViewing(null)}
    />
  );
  if (!top)
    return (
      <>
        {empty(gallery.length > 0)}
        {viewer}
      </>
    );
  const calibrating = top.kind === "calibration";
  // Phones show the bar's icons alone, named by their tooltips.
  const button = (
    choice: Verdict | PairAnswer,
    label: string,
    icon: ReactNode,
    options: { hint?: string; tip?: string; primary?: boolean; disabled?: boolean } = {},
  ) => (
    <Tooltip
      key={choice}
      label={`${options.tip || label}${options.hint ? ` (${options.hint})` : ""}`}
    >
      {phone && icon ? (
        <ActionIcon
          variant={options.primary ? "filled" : "default"}
          radius="xl"
          size={44}
          aria-label={label}
          disabled={options.disabled}
          onClick={() => void act(choice)}
        >
          {icon}
        </ActionIcon>
      ) : (
        <Button
          variant={options.primary ? "filled" : "default"}
          radius="xl"
          leftSection={icon}
          disabled={options.disabled}
          onClick={() => void act(choice)}
        >
          {label}
        </Button>
      )}
    </Tooltip>
  );
  const view = (item: MediaItem, label = "View") => (
    <Tooltip label={label}>
      <ActionIcon
        className={classes.view}
        variant="default"
        radius="xl"
        aria-label={label}
        onClick={() => setViewing({ item, items: [item] })}
      >
        <Maximize2 size={16} />
      </ActionIcon>
    </Tooltip>
  );
  const batch = counts.dreamed + unseen.length;
  return (
    <>
      <BatchStrip done={counts.dreamed} total={batch} />
      <div className={classes.stage}>
        {[next, top].map(
          (card) =>
            card && (
              <SwipeCard
                key={card.key}
                depth={card === top ? 0 : 1}
                fly={fly}
                pair={card.kind === "pair"}
                label={cardLabel(card, card === top)}
                hints={
                  card.kind === "pair"
                    ? { left: "A", right: "B", up: "Both", down: "Neither" }
                    : card.kind === "dream"
                      ? {
                          left: "Skip",
                          right: "Keep",
                          ...(card.item.type === "image" ? { up: "Variations" } : {}),
                        }
                      : { left: "Pass", right: "Like" }
                }
                onTap={(target) => {
                  if (card.kind !== "pair")
                    return setViewing({ item: card.item, items: [card.item] });
                  const side = target.closest<HTMLElement>("[data-side]")?.dataset.side;
                  if (side !== undefined)
                    setViewing({ item: card.items[Number(side)], items: card.items });
                }}
                onSwipe={(direction) => {
                  const choice = card.kind === "pair" ? answers[direction] : intent(direction);
                  if (choice) commit({ card, verdict: choice } as Judgement);
                }}
              >
                {card.kind === "pair" ? (
                  <PairContent
                    card={card}
                    view={(index) =>
                      card === top && view(card.items[index], `View ${sideNames[index]}`)
                    }
                  />
                ) : (
                  <>
                    <div className={classes.media}>
                      <Media item={card.item} playing={card === top} />
                      {card.kind === "calibration" && (
                        <Badge className={classes.label} variant="default">
                          From Your Gallery
                        </Badge>
                      )}
                      {card === top && view(card.item)}
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
                  </>
                )}
              </SwipeCard>
            ),
        )}
      </div>
      <Group className={classes.actions} justify="center" gap="xs" wrap="nowrap">
        {top.kind === "pair" ? (
          <>
            {button("a", "A", null, { hint: "←", tip: top.labels?.[0] && `A: ${top.labels[0]}` })}
            {button("both", "Both", null, { hint: "↑" })}
            {button("neither", "Neither", null, { hint: "↓" })}
            {button("b", "B", null, { hint: "→", tip: top.labels?.[1] && `B: ${top.labels[1]}` })}
          </>
        ) : (
          <>
            {button("discard", calibrating ? "Pass" : "Skip", <X size={18} />, { hint: "←" })}
            {button("refine", "Refine", <WandSparkles size={18} />, {
              disabled: !(image && dream),
            })}
            {button("animate", "Animate", <Clapperboard size={18} />, {
              disabled: !(image && dream),
            })}
            <Tooltip label="Star">
              <ActionIcon
                variant="default"
                radius="xl"
                size={phone ? 44 : 36}
                aria-label="Star"
                onClick={() => void act("star")}
              >
                <Star size={18} />
              </ActionIcon>
            </Tooltip>
            {button("more", "More Like This", <Layers size={18} />, {
              disabled: !(image && dream),
            })}
            {button("keep", calibrating ? "Like" : "Keep", <Heart size={18} />, {
              hint: "→",
              primary: true,
            })}
          </>
        )}
      </Group>
      {!phone && (
        <Text size="xs" c="dimmed" ta="center">
          {top.kind === "pair"
            ? "← A · → B · ↑ Both · ↓ Neither"
            : `← ${calibrating ? "Pass" : "Skip"} · → ${calibrating ? "Like" : "Keep"}${
                image && dream ? " · ↑ Keep & Variations" : ""
              }`}
        </Text>
      )}
      {viewer}
    </>
  );
}
