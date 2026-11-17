import { ActionIcon, Badge, Button, Group, Text, Tooltip } from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { loraName } from "../../../../shared/profiles";
import { failure, post } from "../../api";
import type { MediaItem } from "../../types";
import { ActionBarSurface } from "../../ui/ActionBar";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import { layerAbove } from "../../ui/popupClicks";
import { usePhone, useTouch } from "../../ui/usePhone";
import { mediaSource } from "../gallery/mediaSource";
import { MediaViewer } from "../gallery/MediaViewer";
import { ViewerActionGroups } from "../gallery/MediaViewerActions";
import { galleryKey } from "../gallery/queries";
import { mediaDraft } from "../gallery/useMediaAction";
import { useGenerationActions } from "../generation/GenerationProvider";
import { LoraRatings, loraInfoQuery } from "../generation/LoraPicker";
import { useOpenComposer } from "../generation/openComposer";
import { queueQuery } from "../generation/Queue";
import { type Verdict, deckChoices, viewerChoices } from "./choices";
import { type DeckCard, type PairDeckCard, cardIds, deckCards } from "./deck";
import { PairContent, sideLabel } from "./PairCard";
import {
  type DreamItem,
  type DreamMedia,
  type PairAnswer,
  calibrationQuery,
  dreamItemPath,
  dreamQuery,
  pairAnswerPath,
} from "./queries";
import { type Direction, type Fly, SwipeCard } from "./SwipeCard";

import classes from "./DreamPage.module.css";

type SingleCard = Exclude<DeckCard, PairDeckCard>;
const directions: Record<Verdict, Direction> = {
  discard: "left",
  keep: "right",
  variations: "up",
  like: "right",
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
/** Full screen's verdicts and answers return to the deck; Superlike, Edit and others don't. */
const closing = new Set<string>(["discard", "keep", "a", "b", "both", "neither"]);
/** Verdicts that start work at once, so they send straight away rather than wait for Undo. */
const immediate = new Set<string>(["variations", "animate", "refine", "more"]);

/** Deck media stays still; opening the shared viewer owns playback and its lifecycle. */
function Media({ item }: { item: MediaItem }) {
  const source = mediaSource(item);
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <img
      src={item.type === "video" ? source.thumbnailUrl || source.url : source.displayUrl}
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
      new Image().src = item.type === "video" ? source.thumbnailUrl || "" : source.displayUrl;
    }
  }, [card]);
}

/**
 * Gallery images for calibration, drawn a round at a time; a new round is drawn once fewer than
 * `least` images so far are unjudged, until a round brings nothing new.
 */
function useCalibration(least: number, decided: Set<string>, media: DreamMedia) {
  const [round, setRound] = useState(0);
  const query = useQuery(calibrationQuery(round, media));
  const known = useRef(new Set<string>());
  const [pool, setPool] = useState<{ items: MediaItem[]; added: number }>({ items: [], added: 0 });
  useEffect(() => {
    if (!query.data) return;
    const fresh = query.data.items.filter((item) => !known.current.has(item.id));
    for (const item of fresh) known.current.add(item.id);
    setPool((previous) => ({ items: [...previous.items, ...fresh], added: fresh.length }));
  }, [query.data]);
  const remaining = pool.items.filter((item) => !decided.has(item.id));
  const drained = pool.added > 0 && remaining.length < least;
  useEffect(() => {
    if (drained) setRound((previous) => previous + 1);
  }, [drained]);
  return { items: remaining, loading: query.isPending };
}

export type Judgement =
  | { card: SingleCard; verdict: Verdict }
  | { card: PairDeckCard; verdict: PairAnswer };

/**
 * Sends a verdict: Dream results move to the gallery or, disliked, out of sight; gallery images
 * teach, and a Superlike or Dislike rates them too. A card whose item has gone since it was drawn
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
        // Calibration first: a disliked image leaves the pool calibration reads.
        await post(
          "/api/dream/calibration",
          verdict === "discard" ? { passed: [item.id] } : { liked: [item.id] },
        );
        if (verdict === "like" || verdict === "discard")
          await post("/api/gallery/favorite", {
            ids: [item.id],
            rating: verdict === "like" ? "liked" : "disliked",
          });
        return;
      }
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
    meta: { inlineError: true },
    onError: (error, { card }) => {
      if ((error as Error & { status?: number }).status === 404) return;
      failure(error);
      onFailed(card);
    },
    onSettled: () =>
      Promise.all(
        [dreamQuery.queryKey, galleryKey, ["gallery-filters"]].map((queryKey) =>
          client.invalidateQueries({ queryKey }),
        ),
      ),
  });
}

/** How many Dream results a card holds; calibration cards hold none. */
const dreamed = (card: DeckCard) =>
  card.kind === "dream" ? 1 : card.kind === "pair" && card.pairId ? 2 : 0;

function Caption({ item }: { item: DreamItem }) {
  const info = useQuery(loraInfoQuery);
  // The LoRAs Dream tried, each rated here so a new one joins (or leaves) the account's Liked LoRAs.
  const loras = (Array.isArray(item.settings?.loras) ? item.settings.loras : [])
    .filter((lora) => lora?.name && lora.enabled !== false)
    .map((lora) => String(lora.name));
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
      {loras.map((file) => {
        const title = loraName(file, info.data?.loras[file]);
        return (
          <Group key={file} gap="xs" wrap="nowrap" justify="space-between">
            <Text size="xs" truncate>
              LoRA: {title}
            </Text>
            <LoraRatings file={file} title={title} />
          </Group>
        );
      })}
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

/** The unseen deck and its shared preview; tapping media opens it, actions and swipes judge it. */
export function DreamDeck({
  items,
  media,
  pairsOnly,
  empty,
  undoTarget,
}: {
  items: DreamItem[];
  media: DreamMedia;
  pairsOnly: boolean;
  empty: ReactNode;
  undoTarget: HTMLDivElement | null;
}) {
  const phone = usePhone();
  const touch = useTouch();
  const [current, setCurrent] = useState<DeckCard>();
  const [decided, setDecided] = useState<Set<string>>(() => new Set());
  const [counts, setCounts] = useState({ judged: 0, dreamed: 0 });
  // The id of the top card's item open in the viewer; after a verdict it follows the next card.
  const [viewing, setViewing] = useState<string | null>(null);
  // The side a tap chose, outlined while its card leaves.
  const [picked, setPicked] = useState<{ key: string; side: 0 | 1 } | null>(null);
  /** Puts a card back on the deck, after a failed verdict or an Undo. */
  const restore = (card: DeckCard) => {
    setCurrent(card);
    setDecided((previous) => {
      const next = new Set(previous);
      for (const id of cardIds(card)) next.delete(id);
      return next;
    });
  };
  const judge = useJudge(restore);
  const unseen = items.filter((item) => !decided.has(item.id));
  const gallery = useCalibration(pairsOnly ? 2 : 1, decided, media);
  const cards = deckCards(unseen, gallery.items, counts.judged, { pairsOnly, media, current });
  const [top, next] = cards;
  if (top !== current) setCurrent(top);
  usePrefetch(cards[2]);
  const fly = useRef<Fly | null>(null);
  const stage = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const single = top?.kind === "pair" ? undefined : top;
  const image = single?.item.type === "image";
  const dream = single?.kind === "dream";

  /** Takes the card off the deck. */
  function decide(card: DeckCard) {
    setCurrent(undefined);
    setDecided((previous) => {
      const next = new Set(previous);
      for (const id of cardIds(card)) next.add(id);
      return next;
    });
    setCounts((previous) => ({
      judged: previous.judged + 1,
      dreamed: previous.dreamed + dreamed(card),
    }));
  }
  // The last judgement waits for Undo until the next one, leaving the deck or hiding the page.
  const [pending, setPending] = useState<Judgement | null>(null);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  function send() {
    const last = pendingRef.current;
    if (!last) return;
    pendingRef.current = null;
    setPending(null);
    judge.mutate(last);
  }
  const sendRef = useRef(send);
  sendRef.current = send;
  useEffect(() => {
    const hide = () => document.visibilityState === "hidden" && sendRef.current();
    document.addEventListener("visibilitychange", hide);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      sendRef.current();
    };
  }, []);
  /** Takes the card off the deck, holding its judgement for Undo unless it starts work. */
  function commit(judgement: Judgement) {
    send();
    decide(judgement.card);
    if (immediate.has(judgement.verdict)) return judge.mutate(judgement);
    pendingRef.current = judgement;
    setPending(judgement);
  }
  function undo() {
    const last = pendingRef.current;
    if (!last) return;
    pendingRef.current = null;
    setPending(null);
    setPicked(null);
    restore(last.card);
    setCounts((previous) => ({
      judged: previous.judged - 1,
      dreamed: previous.dreamed - dreamed(last.card),
    }));
  }
  /** Flies the top card out its way, then commits the verdict or answer. */
  async function act(choice: Verdict | PairAnswer) {
    if (!top || busy.current) return;
    busy.current = true;
    try {
      if (top.kind === "pair") {
        if (!(choice in answerDirections)) return;
        if (choice === "a" || choice === "b")
          setPicked({ key: top.key, side: choice === "a" ? 0 : 1 });
        await fly.current?.(answerDirections[choice as PairAnswer]);
        return commit({ card: top, verdict: choice as PairAnswer });
      }
      if (!(choice in directions)) return;
      if (immediate.has(choice) && !(image && dream)) return;
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
      if (layerAbove(null, event)) return;
      const choice = keyRef.current(direction);
      if (!choice) return;
      event.preventDefault();
      void actRef.current(choice);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The viewer shows the top card, so a verdict there moves on to the next card in place.
  const shown = !top ? [] : top.kind === "pair" ? top.items : [top.item];
  if (viewing && !shown.length) setViewing(null);
  const pairLabel = (item: MediaItem) =>
    top?.kind === "pair"
      ? sideLabel(
          top,
          top.items.findIndex((side) => side.id === item.id),
        )
      : "";
  const viewer = viewing && top && (
    <MediaViewer
      item={shown.find((item) => item.id === viewing) || shown[0]}
      items={shown}
      navigate={(item) => setViewing(item.id)}
      close={() => setViewing(null)}
      onReturnFocus={(item) => {
        const targets = [
          ...(stage.current?.querySelectorAll<HTMLElement>('[data-depth="0"] [data-preview-id]') ??
            []),
        ];
        (targets.find((target) => target.dataset.previewId === item.id) ?? targets[0])?.focus({
          preventScroll: true,
        });
      }}
      actions={viewerChoices(top, (choice) => {
        if (closing.has(choice)) setViewing(null);
        void act(choice);
      })}
      itemLabel={top.kind === "pair" ? pairLabel : undefined}
      sideBySide={top.kind === "pair"}
    />
  );
  const undoAction = {
    id: "undo",
    label: "Undo",
    icon: icons.undo,
    disabled: !pending,
    onClick: undo,
  };
  // With the deck empty, Undo brings back the last card from the toolbar.
  const emptyUndo =
    pending &&
    undoTarget &&
    createPortal(
      <Button
        size="compact-xs"
        variant="subtle"
        leftSection={<icons.undo size={12} />}
        onClick={undo}
      >
        Undo
      </Button>,
      undoTarget,
    );
  if (!top)
    return gallery.loading ? (
      <LoadingState fill label="Loading Dream" />
    ) : (
      <>
        {empty}
        {emptyUndo}
      </>
    );
  const actions = deckChoices(top, (choice) => void act(choice), undoAction);
  const view = (item: MediaItem) => (
    <Tooltip label="View">
      <ActionIcon
        className={classes.view}
        variant="default"
        aria-label="View"
        data-preview-id={item.id}
        onClick={() => setViewing(item.id)}
      >
        <icons.preview size={16} />
      </ActionIcon>
    </Tooltip>
  );
  const batch = counts.dreamed + unseen.length;
  return (
    <>
      <BatchStrip done={counts.dreamed} total={batch} />
      <div ref={stage} className={classes.stage} aria-hidden={!!viewing} inert={!!viewing}>
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
                    : {
                        left: "Dislike",
                        right: "Like",
                        ...(card.kind === "dream" && card.item.type === "image"
                          ? { up: "Variations" }
                          : {}),
                      }
                }
                onTap={(target) => {
                  if (card.kind !== "pair") return setViewing(card.item.id);
                  const side = target.closest<HTMLElement>("[data-side]")?.dataset.side;
                  setViewing(card.items[Number(side ?? 0)].id);
                }}
                onHold={(target) => {
                  if (card.kind !== "pair") return setViewing(card.item.id);
                  const side = target.closest<HTMLElement>("[data-side]")?.dataset.side;
                  setViewing(card.items[Number(side ?? 0)].id);
                }}
                onSwipe={(direction) => {
                  const choice = card.kind === "pair" ? answers[direction] : intent(direction);
                  if (!choice) return;
                  commit({ card, verdict: choice } as Judgement);
                }}
              >
                {card.kind === "pair" ? (
                  <PairContent
                    card={card}
                    top={card === top}
                    picked={picked?.key === card.key ? picked.side : undefined}
                    view={(side) => setViewing(card.items[side].id)}
                  />
                ) : (
                  <>
                    <div className={classes.media}>
                      <Media item={card.item} />
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
      <ActionBarSurface
        aria-label={actions.label}
        className={classes.actions}
        radius="lg"
        aria-hidden={!!viewing}
        inert={!!viewing}
      >
        <ViewerActionGroups {...actions} />
      </ActionBarSurface>
      {!phone && !touch && (
        <Text size="xs" c="dimmed" ta="center">
          {top.kind === "pair"
            ? "← A · → B · ↑ Both · ↓ Neither"
            : `← Dislike · → Like${image && dream ? " · ↑ Like & Variations" : ""}`}
        </Text>
      )}
      {viewer}
    </>
  );
}
