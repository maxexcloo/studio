import { ActionIcon, Badge, Button, Text, Tooltip } from "@mantine/core";
import { type QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal, flushSync } from "react-dom";

import { failure, post } from "../../api";
import type { MediaItem } from "../../types";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import { layerAbove } from "../../ui/popupClicks";
import { usePhone, useSideways, useTouch } from "../../ui/usePhone";
import { mediaSource } from "../gallery/mediaSource";
import { galleryKey } from "../gallery/queries";
import { mediaDraft } from "../gallery/useMediaAction";
import { useGenerationActions } from "../generation/GenerationProvider";
import { useOpenComposer } from "../generation/openComposer";
import { queueQuery } from "../generation/Queue";
import type { Verdict } from "./choices";
import { type DeckCard, type PairDeckCard, cardIds, deckCards } from "./deck";
import { DeckButtons } from "./DeckButtons";
import { DeckMedia } from "./DeckMedia";
import { CardText, DreamPreview, PreviewFace, PreviewSides } from "./DreamPreview";
import { LibrarySuggest } from "./LibrarySuggest";
import { PairContent } from "./PairCard";
import {
  type DreamItem,
  type DreamMedia,
  type PairAnswer,
  calibrationQuery,
  dreamItemPath,
  dreamQuery,
  libraryReviewPath,
  pairAnswerPath,
} from "./queries";
import { type Direction, type Fly, SwipeCard } from "./SwipeCard";

import classes from "./DreamPage.module.css";

type SingleCard = Exclude<DeckCard, PairDeckCard>;
/** The deck's verdicts, the ways their cards fly. */
const directions: Record<string, Direction> = { discard: "left", keep: "right", like: "up" };
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
/** Warms the browser cache for a card that is not on screen yet. */
function usePrefetch(card?: DeckCard) {
  useEffect(() => {
    if (!card) return;
    for (const item of card.kind === "pair" ? card.items : [card.item]) {
      const source = mediaSource(item);
      new Image().src = item.type === "video" ? source.thumbnailUrl || "" : source.displayUrl;
    }
  }, [card]);
}

/**
 * Gallery images for calibration, drawn a round at a time; a new round is drawn once fewer than
 * `least` images so far are unjudged, until a round brings nothing new.
 */
function useCalibration(least: number, decided: Set<string>, media: DreamMedia, enabled: boolean) {
  const [round, setRound] = useState(0);
  const query = useQuery({ ...calibrationQuery(round, media), enabled });
  const known = useRef(new Set<string>());
  const [pool, setPool] = useState<{ items: MediaItem[]; added: number }>({ items: [], added: 0 });
  useEffect(() => {
    if (!query.data) return;
    const fresh = query.data.items.filter((item) => !known.current.has(item.id));
    for (const item of fresh) known.current.add(item.id);
    setPool((previous) => ({ items: [...previous.items, ...fresh], added: fresh.length }));
  }, [query.data]);
  const remaining = pool.items.filter((item) => !decided.has(item.id));
  const drained = enabled && pool.added > 0 && remaining.length < least;
  useEffect(() => {
    if (drained) setRound((previous) => previous + 1);
  }, [drained]);
  return { items: remaining, loading: enabled && query.isPending };
}

export type Judgement =
  | { card: SingleCard; verdict: Verdict }
  | { card: PairDeckCard; verdict: PairAnswer; like?: true };

/**
 * Sends a verdict: Dream results move to the gallery or, disliked, out of sight; gallery images
 * teach, and a Like or Dislike rates them too. A card whose item has gone since it was drawn
 * just leaves the deck; other failures put it back.
 */
export function useJudge(onFailed: (card: DeckCard) => void) {
  const client = useQueryClient();
  const openComposer = useOpenComposer();
  const { setDraft } = useGenerationActions();
  return useMutation({
    mutationFn: async (judgement: Judgement) => {
      if (judgement.card.kind === "pair") {
        const { pairId, items } = judgement.card;
        const answer = judgement.verdict as PairAnswer;
        if (pairId)
          return post(pairAnswerPath(pairId), {
            answer,
            ...("like" in judgement && judgement.like && { like: true }),
          });
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
      if (judgement.card.kind === "library")
        return verdict === "keep"
          ? post(libraryReviewPath(item), { reviewed: true })
          : post("/api/gallery/favorite", {
              ids: [item.id],
              rating: verdict === "like" ? "liked" : "disliked",
            });
      if (judgement.card.kind === "calibration")
        return post(
          "/api/dream/calibration",
          verdict === "discard"
            ? { passed: [item.id], rating: "disliked" }
            : { liked: [item.id], ...(verdict === "like" && { rating: "liked" }) },
        );
      if (verdict === "discard") return post(dreamItemPath(item, "discard"));
      if (verdict === "more") return post(dreamItemPath(item, "more"));
      if (verdict === "variations") {
        await post(dreamItemPath(item, "variations"));
        return client.invalidateQueries({ queryKey: queueQuery.queryKey });
      }
      // Liking an unseen result keeps it (backend/domain/dream.ts).
      if (verdict === "like")
        return post("/api/gallery/favorite", { ids: [item.id], rating: "liked" });
      await post(dreamItemPath(item, "keep"));
      // As the viewer's Animate in Composer and Edit, staged in the composer for review.
      if (verdict === "animate" || verdict === "refine") {
        const { draft } = await mediaDraft(item, verdict, client);
        setDraft(draft);
        openComposer(verdict === "animate" ? "video" : "image");
      }
    },
    // A verdict and its Undo run in order.
    scope: { id: "dream-judgements" },
    meta: { inlineError: true },
    onError: (error, { card }) => {
      if (gone(error)) return;
      failure(error);
      onFailed(card);
    },
    onSettled: () => refresh(client),
  });
}

const gone = (error: Error) => (error as Error & { status?: number }).status === 404;
const refresh = (client: QueryClient) =>
  Promise.all(
    [dreamQuery.queryKey, galleryKey, ["gallery-filters"]].map((queryKey) =>
      client.invalidateQueries({ queryKey }),
    ),
  );

/**
 * Takes a judgement and any rating it gave back together. `onFailed` takes the card off again.
 */
function useUndo(onFailed: (judgement: Judgement) => void, onGone: (card: DeckCard) => void) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ card, verdict }: Judgement) => {
      if (card.kind === "library")
        return verdict === "keep"
          ? post(libraryReviewPath(card.item), { reviewed: false })
          : post("/api/gallery/favorite", {
              ids: [card.item.id],
              rating: card.item.rating ?? null,
            });
      const rated =
        card.kind !== "pair" &&
        (verdict === "like" || (card.kind === "calibration" && verdict === "discard"));
      const calibration = card.kind === "calibration" || (card.kind === "pair" && !card.pairId);
      await post("/api/dream/undo", {
        ids: cardIds(card),
        ...(calibration && { calibration }),
        ...(rated && { rating: card.item.rating ?? null }),
      });
    },
    scope: { id: "dream-judgements" },
    meta: { inlineError: true },
    onError: (error, judgement) => {
      if (gone(error)) return onGone(judgement.card);
      failure(error);
      onFailed(judgement);
    },
    onSettled: () => refresh(client),
  });
}

const cardLabel = (card: DeckCard, top: boolean) =>
  card.kind === "pair"
    ? top
      ? card.question
      : "Next Comparison"
    : `${top ? "Current" : "Next"} ${card.kind === "dream" ? "Dream" : card.item.type === "video" ? "Gallery Video" : "Gallery Image"}`;

/** The unseen deck and its preview; tapping media opens it, buttons, keys and swipes judge it. */
export function DreamDeck({
  items,
  decided,
  setDecided,
  libraryItems,
  libraryWaiting,
  media,
  pairsOnly,
  empty,
  undoTarget,
}: {
  items: DreamItem[];
  decided: Set<string>;
  setDecided: Dispatch<SetStateAction<Set<string>>>;
  libraryItems?: MediaItem[];
  libraryWaiting: boolean;
  media: DreamMedia;
  pairsOnly: boolean;
  empty: ReactNode;
  undoTarget: HTMLDivElement | null;
}) {
  const phone = usePhone();
  const touch = useTouch();
  // A phone held sideways gives the text its own scrolling column, so it shows in full.
  const sideways = useSideways();
  const [current, setCurrent] = useState<DeckCard>();
  const [judged, setJudged] = useState(0);
  // The top card open in the preview, and a comparison's side shown there.
  const [viewing, setViewing] = useState<{ key: string; side: number } | null>(null);
  // The side a tap chose, outlined while its card leaves.
  const [selected, setSelected] = useState<{ key: string; side: 0 | 1 }>();
  const [picked, setPicked] = useState<{ key: string; side: 0 | 1 } | null>(null);
  // This session's judgements that Undo can take back, newest last.
  const [history, setHistory] = useState<Judgement[]>([]);
  // Dream results Undo returned, shown until the next read lists them again.
  const [returned, setReturned] = useState<DreamItem[]>([]);
  /** Puts a card back on the deck, after a failed verdict or an Undo. */
  const restore = (card: DeckCard) => {
    setCurrent(card);
    setDecided((previous) => {
      const next = new Set(previous);
      for (const id of cardIds(card)) next.delete(id);
      return next;
    });
  };
  const judge = useJudge((card) => {
    setHistory((previous) => previous.filter((judgement) => judgement.card !== card));
    restore(card);
  });
  const takeBack = useUndo(
    (judgement) => {
      decide(judgement.card);
      setHistory((previous) => [...previous, judgement]);
    },
    (card) => decide(card),
  );
  const unseen = [
    ...items,
    ...returned.filter((item) => !items.some((listed) => listed.id === item.id)),
  ].filter((item) => !decided.has(item.id));
  const gallery = useCalibration(pairsOnly ? 2 : 1, decided, media, !libraryItems);
  const libraryCards: DeckCard[] = (libraryItems || [])
    .slice(0, 3)
    .map((item) => ({ kind: "library", key: item.id, item }));
  const cards = libraryItems
    ? current?.kind === "library" && libraryItems.some((item) => item.id === current.key)
      ? [current, ...libraryCards.filter((card) => card.key !== current.key)].slice(0, 3)
      : libraryCards
    : deckCards(unseen, gallery.items, judged, { pairsOnly, media, current });
  const [top, next] = cards;
  if (top !== current) setCurrent(top);
  const shown =
    viewing?.key === top?.key
      ? (viewing?.side ?? 0)
      : selected?.key === top?.key
        ? (selected?.side ?? 0)
        : 0;
  usePrefetch(cards[2]);
  const fly = useRef<Fly | null>(null);
  const previewFly = useRef<Fly | null>(null);
  const busy = useRef(false);

  /** Takes the card off the deck. */
  function decide(card: DeckCard) {
    setCurrent(undefined);
    setDecided((previous) => {
      const next = new Set(previous);
      for (const id of cardIds(card)) next.add(id);
      return next;
    });
    setJudged((previous) => previous + 1);
  }
  /** Takes the card off the deck and sends its judgement, which Undo can take back. */
  function commit(judgement: Judgement) {
    decide(judgement.card);
    judge.mutate(judgement);
    setHistory((previous) => [...previous, judgement]);
  }
  /** Puts the last judged card back on top and takes its judgement back. */
  function undo() {
    const last = history.at(-1);
    if (!last || busy.current) return;
    setHistory((previous) => previous.slice(0, -1));
    setPicked(null);
    const { card } = last;
    if (card.kind === "dream") setReturned((previous) => [...previous, card.item]);
    else if (card.kind === "pair" && card.pairId)
      setReturned((previous) => [...previous, ...(card.items as DreamItem[])]);
    restore(card);
    setJudged((previous) => previous - 1);
    takeBack.mutate(last);
  }
  /** Flies the top card out its way, on the deck or in the preview, then commits the verdict. */
  async function act(choice: Verdict | PairAnswer) {
    if (!top || busy.current) return;
    busy.current = true;
    const out = (viewing ? previewFly : fly).current;
    try {
      if (top.kind === "pair") {
        const like = top.pairId && choice === "like";
        const answer = like ? (shown ? "b" : "a") : (choice as PairAnswer);
        if (!(answer in answerDirections)) return;
        if (answer === "a" || answer === "b")
          setPicked({ key: top.key, side: answer === "a" ? 0 : 1 });
        await out?.(like ? "up" : answerDirections[answer]);
        return commit({ card: top, verdict: answer, ...(like && { like: true }) });
      }
      if (!(choice in directions)) return;
      await out?.(directions[choice]);
      commit({ card: top, verdict: choice as Verdict });
    } finally {
      busy.current = false;
    }
  }
  /** What a swipe or arrow key in a direction means for the top card. */
  const intent = (direction: Direction): Verdict | PairAnswer | null =>
    top?.kind === "pair"
      ? direction === "up" && top.pairId
        ? "like"
        : answers[direction]
      : ({ left: "discard", right: "keep", up: "like", down: null } as const)[direction];
  /** Arrow keys judge and U or Z undoes, on the deck and in its preview. */
  function respond(event: KeyboardEvent) {
    const direction = keyDirections[event.key];
    const undoKey = event.key === "u" || event.key === "z";
    if (
      (!direction && !undoKey) ||
      event.defaultPrevented ||
      event.altKey ||
      event.metaKey ||
      event.ctrlKey
    )
      return;
    const target = event.target as HTMLElement;
    if (target.closest("input, textarea, select, [contenteditable='true'], [role='slider']"))
      return;
    if (undoKey) return undo();
    const choice = intent(direction);
    if (!choice) return;
    event.preventDefault();
    void act(choice);
  }
  const respondRef = useRef(respond);
  respondRef.current = respond;
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!layerAbove(null, event)) respondRef.current(event);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The preview follows the top card, opening a comparison on its first side.
  if (viewing && !top) setViewing(null);
  else if (viewing && top && viewing.key !== top.key) setViewing({ key: top.key, side: 0 });
  const open = (card: DeckCard, side = 0) => setViewing({ key: card.key, side });
  /** Opens the side of a comparison pressed, or a single card. */
  const openPressed = (card: DeckCard, target: HTMLElement) =>
    open(card, Number(target.closest<HTMLElement>("[data-side]")?.dataset.side ?? 0));
  function closePreview() {
    if (!viewing || !top) return;
    const item = top.kind === "pair" ? top.items[viewing.side] : top.item;
    // The preview mounts open, so Mantine has no opening to return focus from.
    flushSync(() => {
      if (top.kind === "pair") setSelected({ key: top.key, side: viewing.side ? 1 : 0 });
      setViewing(null);
    });
    document
      .querySelector<HTMLElement>(`[data-depth="0"] [data-preview-id="${CSS.escape(item.id)}"]`)
      ?.focus({ preventScroll: true });
  }
  /** The deck's card, or with `full` the preview's, for the top card or the one beneath. */
  const swipeCard = (card: DeckCard, full: boolean) => {
    const isTop = card === top;
    const playing = isTop && (full || !viewing);
    const side = isTop && viewing ? viewing.side : 0;
    return (
      <SwipeCard
        key={card.key}
        depth={isTop ? 0 : 1}
        paused={!playing}
        previewSide={full && card.kind === "pair" ? side : undefined}
        // A comparison's preview swipes between its sides, and answers with its buttons.
        still={full && card.kind === "pair"}
        full={full}
        fly={full ? previewFly : fly}
        pair={card.kind === "pair"}
        label={cardLabel(card, isTop)}
        hints={
          card.kind === "pair"
            ? full
              ? {}
              : { left: "A", right: "B", up: card.pairId ? "Like" : "Both", down: "Neither" }
            : { left: "Dislike", right: "Accept", up: "Like" }
        }
        onTap={full ? undefined : (target) => openPressed(card, target)}
        onHold={full ? undefined : (target) => openPressed(card, target)}
        onSwipe={(direction, target) => {
          if (card.kind === "pair" && card.pairId && direction === "up") {
            const side = target.closest<HTMLElement>("[data-side]")?.dataset.side ?? String(shown);
            return commit({ card, verdict: side === "1" ? "b" : "a", like: true });
          }
          const choice = card.kind === "pair" ? answers[direction] : intent(direction);
          if (!choice) return;
          commit({ card, verdict: choice } as Judgement);
        }}
      >
        {card.kind === "pair" ? (
          full ? (
            <PreviewSides
              card={card}
              side={side}
              setSide={(side) => open(card, side)}
              onLike={isTop && card.pairId ? () => void act("like") : undefined}
            />
          ) : (
            <PairContent
              card={card}
              top={isTop}
              playing={playing}
              picked={picked?.key === card.key ? picked.side : undefined}
              shown={isTop && card.pairId ? shown : undefined}
              select={(side) => setSelected({ key: card.key, side })}
              view={(side) => open(card, side)}
            />
          )
        ) : full ? (
          <PreviewFace item={card.item} dreamt={card.kind === "dream"} />
        ) : (
          <>
            <div className={classes.media}>
              <DeckMedia item={card.item} playing={playing} />
              {(card.kind === "calibration" || card.kind === "library") && (
                <Badge className={classes.label} variant="default">
                  From Your Gallery
                </Badge>
              )}
              {isTop && (
                <Tooltip label="View">
                  <ActionIcon
                    className={classes.view}
                    variant="default"
                    aria-label="View"
                    data-preview-id={card.item.id}
                    onClick={() => open(card)}
                  >
                    <icons.preview size={16} />
                  </ActionIcon>
                </Tooltip>
              )}
            </div>
            {isTop &&
              card.kind === "library" &&
              card.item.jobId &&
              card.item.prompt?.trim() &&
              card.item.settings?.profileId && (
                <LibrarySuggest key={card.item.id} item={card.item} />
              )}
            <CardText item={card.item} dreamt={card.kind === "dream"} full={sideways} />
          </>
        )}
      </SwipeCard>
    );
  };
  // Undo stands beside the view menu, so it stays in reach with the deck empty too.
  const undoButton =
    undoTarget &&
    createPortal(
      <Button
        size="compact-sm"
        variant="subtle"
        color="gray"
        leftSection={<icons.undo size={14} />}
        disabled={!history.length}
        onClick={undo}
      >
        Undo
      </Button>,
      undoTarget,
    );
  if (!top)
    return libraryWaiting || gallery.loading ? (
      <LoadingState fill label={libraryItems ? "Loading Library" : "Loading Dream"} />
    ) : (
      <>
        {empty}
        {undoButton}
      </>
    );
  const stack = (full: boolean) => [next, top].map((card) => card && swipeCard(card, full));
  return (
    <>
      <div className={classes.stage} aria-hidden={!!viewing} inert={!!viewing}>
        {stack(false)}
      </div>
      <DeckButtons
        card={top}
        act={(choice) => void act(choice)}
        hidden={!!viewing}
        shown={top.kind === "pair" && top.pairId ? shown : undefined}
      />
      {!phone && !touch && (
        <Text size="xs" c="dimmed" ta="center">
          {top.kind === "pair"
            ? `← A · → B · ↑ ${top.pairId ? "Like" : "Both"} · ↓ Neither · U Undo`
            : "← Dislike · → Accept · ↑ Like · U Undo"}
        </Text>
      )}
      {undoButton}
      {viewing && (
        <DreamPreview
          card={top}
          side={viewing.side}
          canUndo={history.length > 0}
          close={closePreview}
          act={(choice) => void act(choice)}
          undo={undo}
          onKeyDown={(event) => {
            // A comparison's sides step with the arrows; its answers are its buttons.
            if (top.kind !== "pair" || (top.pairId && event.key === "ArrowUp"))
              return respond(event.nativeEvent);
            const step = ({ ArrowLeft: -1, ArrowRight: 1 } as Record<string, number>)[event.key];
            const { altKey, ctrlKey, metaKey, shiftKey } = event;
            if (!step || altKey || ctrlKey || metaKey || shiftKey || event.defaultPrevented) return;
            if ((event.target as Element).closest("[role='slider']")) return;
            event.preventDefault();
            const side = viewing.side + step;
            if (side >= 0 && side < top.items.length) open(top, side);
          }}
        >
          {stack(true)}
        </DreamPreview>
      )}
    </>
  );
}
