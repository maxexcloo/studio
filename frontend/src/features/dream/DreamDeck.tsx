import { ActionIcon, Badge, Box, Button, Modal, Radio, Stack, Text, Tooltip } from "@mantine/core";
import { type QueryClient, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";

import type { DreamPassReason } from "../../../../shared/dream";
import { failure, post } from "../../api";
import type { MediaItem } from "../../types";
import { DialogFooter } from "../../ui/ConfirmDialog";
import { icons } from "../../ui/icons";
import { LoadingState } from "../../ui/LoadingState";
import { closeWhenTop, layerAbove } from "../../ui/popupClicks";
import { usePhone, useSideways, useTouch } from "../../ui/usePhone";
import { mediaSource } from "../gallery/mediaSource";
import { galleryKey } from "../gallery/queries";
import { mediaDraft } from "../gallery/useMediaAction";
import { useGenerationActions } from "../generation/GenerationProvider";
import { useOpenComposer } from "../generation/openComposer";
import { queueQuery } from "../generation/Queue";
import type { Verdict } from "./choices";
import { type DeckCard, type PairDeckCard, cardIds, deckCards } from "./deck";
import { DeckButtons, DeckUndo } from "./DeckButtons";
import { DeckMedia } from "./DeckMedia";
import { CardText, DreamPreview } from "./DreamPreview";
import { DreamSuggestions } from "./DreamSuggestions";
import { PairContent } from "./PairCard";
import {
  type DreamItem,
  type DreamMedia,
  type PairAnswer,
  type SetOverride,
  type SetOverrides,
  comparisonVotes,
  dreamItemPath,
  dreamQuery,
  libraryReviewPath,
  pairAnswerPath,
  setAnswerPath,
} from "./queries";
import { type Direction, type Fly, SwipeCard } from "./SwipeCard";

import classes from "./DreamPage.module.css";

type SingleCard = Exclude<DeckCard, PairDeckCard>;
/** The deck's verdicts, the ways their cards fly. */
const directions: Record<string, Direction> = {
  discard: "left",
  keep: "right",
  like: "up",
  more: "up",
};
const comparisonSwipes: Record<Direction, PairAnswer> = {
  left: "a",
  right: "b",
  up: "both",
  down: "neither",
};
const answerDirections: Record<PairAnswer, Direction> = {
  a: "left",
  b: "right",
  c: "right",
  both: "up",
  neither: "down",
};
const keyDirections: Record<string, Direction> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};
const passLabels = {
  taste: "Not My Taste",
  similar: "Too Similar",
  glitch: "Glitch",
} satisfies Record<Exclude<DreamPassReason, "skip">, string>;
const passReasons = Object.keys(passLabels) as (keyof typeof passLabels)[];
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

export type Judgement = (
  | { card: SingleCard; verdict: Verdict; likedId?: string; overrides?: SetOverrides }
  | { card: PairDeckCard; verdict: PairAnswer }
) & { passReason?: DreamPassReason; superLike?: true };

/**
 * Sends a verdict: Dream results move to the gallery or, disliked, out of sight; gallery images
 * teach, and a Like or Dislike rates them too. A card whose item has gone since it was drawn
 * just leaves the deck; other failures put it back.
 */
export function useJudge(onFailed: (card: DeckCard, judgement: Judgement) => void) {
  const client = useQueryClient();
  const openComposer = useOpenComposer();
  const { setDraft } = useGenerationActions();
  return useMutation({
    mutationFn: async (judgement: Judgement) => {
      if (judgement.passReason && judgement.card.kind !== "library")
        return post("/api/dream/pass", {
          ids: cardIds(judgement.card),
          reason: judgement.passReason,
        });
      if (judgement.card.kind === "pair") {
        return post(pairAnswerPath(judgement.card.pairId), {
          answer: judgement.verdict,
          ...(judgement.superLike && { like: true }),
        });
      }
      if (judgement.card.kind === "set")
        return post(setAnswerPath(judgement.card.setId), {
          ids: cardIds(judgement.card),
          verdict: judgement.verdict,
          ...("likedId" in judgement && judgement.likedId && { likedId: judgement.likedId }),
          ...("overrides" in judgement &&
            judgement.overrides && { overrides: judgement.overrides }),
        });
      const { item } = judgement.card;
      const verdict = judgement.verdict as Verdict;
      if (judgement.card.kind === "library")
        return verdict === "keep" || (judgement.passReason && judgement.passReason !== "taste")
          ? post(libraryReviewPath(item), { reviewed: true })
          : post("/api/gallery/favorite", {
              ids: [item.id],
              rating: verdict === "like" ? "liked" : "disliked",
            });
      if (verdict === "discard") return post(dreamItemPath(item, "discard"));
      if (verdict === "more") return post(dreamItemPath(item, "more"));
      if (verdict === "variations") {
        await post(dreamItemPath(item, "variations"));
        return client.invalidateQueries({ queryKey: queueQuery.queryKey });
      }
      if (judgement.superLike) return post(dreamItemPath(item, "super-like"));
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
    onError: (error, judgement) => {
      if (gone(error)) return;
      failure(error);
      onFailed(judgement.card, judgement);
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
    mutationFn: async ({ card, verdict, passReason }: Judgement) => {
      if (card.kind === "library")
        return verdict === "keep" || (passReason && passReason !== "taste")
          ? post(libraryReviewPath(card.item), { reviewed: false })
          : post("/api/gallery/favorite", {
              ids: [card.item.id],
              rating: card.item.rating ?? null,
            });
      await post("/api/dream/undo", {
        ids: cardIds(card),
        ...(card.kind === "set" && { setId: card.setId }),
        ...(card.kind === "dream" && verdict === "like" && { rating: card.item.rating ?? null }),
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
    : card.kind === "set"
      ? top
        ? card.title
        : "Next Set"
      : `${top ? "Current" : "Next"} ${card.kind === "dream" ? "Dream" : card.item.type === "video" ? "Gallery Video" : "Gallery Image"}`;

/** The unseen deck and its preview; tapping media opens it, buttons, keys and swipes judge it. */
export function DreamDeck({
  items,
  setDecided,
  history,
  setHistory,
  returnItems,
  libraryItems,
  libraryWaiting,
  media,
  empty,
  quickRating = false,
}: {
  items: DreamItem[];
  setDecided: Dispatch<SetStateAction<Set<string>>>;
  history: Judgement[];
  setHistory: Dispatch<SetStateAction<Judgement[]>>;
  returnItems: (items: DreamItem[]) => void;
  libraryItems?: MediaItem[];
  libraryWaiting: boolean;
  media: DreamMedia;
  empty: ReactNode;
  /** Gallery's rating mode uses left for Dislike and right for Like. */
  quickRating?: boolean;
}) {
  const phone = usePhone();
  const stage = useRef<HTMLDivElement>(null);
  const touch = useTouch();
  // A phone held sideways gives the text its own scrolling column, so it shows in full.
  const sideways = useSideways();
  const [current, setCurrent] = useState<DeckCard>();
  // The top card open in the preview, and a comparison's side shown there.
  const [viewing, setViewing] = useState<{ key: string; side: number } | null>(null);
  // The side a tap chose, outlined while its card leaves.
  const [selected, setSelected] = useState<{ key: string; side: number }>();
  const [picked, setPicked] = useState<{ key: string; side: number } | null>(null);
  const [setDraft, setSetDraft] = useState<{ key: string; overrides: SetOverrides }>();
  const [passing, setPassing] = useState<string>();
  const [passReason, setPassReason] = useState(passReasons[0]);
  const passDialogId = useId();
  const closePass = closeWhenTop(passDialogId, () => setPassing(undefined));
  /** Puts a card back on the deck, after a failed verdict or an Undo. */
  const restore = (card: DeckCard) => {
    setCurrent(card);
    setDecided((previous) => {
      const next = new Set(previous);
      for (const id of cardIds(card)) next.delete(id);
      return next;
    });
  };
  const restoreDraft = (judgement: Judgement) => {
    if ("overrides" in judgement && judgement.overrides)
      setSetDraft({ key: judgement.card.key, overrides: judgement.overrides });
  };
  const judge = useJudge((card, judgement) => {
    setHistory((previous) => previous.filter((judgement) => judgement.card !== card));
    restore(card);
    restoreDraft(judgement);
  });
  const takeBack = useUndo(
    (judgement) => {
      decide(judgement.card);
      setSetDraft((draft) => (draft?.key === judgement.card.key ? undefined : draft));
      setHistory((previous) => [...previous, judgement]);
    },
    (card) => decide(card),
  );
  const libraryCards: DeckCard[] = (libraryItems || [])
    .slice(0, 3)
    .map((item) => ({ kind: "library", key: item.id, item }));
  const cards = libraryItems
    ? current?.kind === "library" && libraryItems.some((item) => item.id === current.key)
      ? [current, ...libraryCards.filter((card) => card.key !== current.key)].slice(0, 3)
      : libraryCards
    : deckCards(items, { media, current });
  const [top] = cards;
  if (top !== current) setCurrent(top);
  const requestedSide =
    viewing?.key === top?.key
      ? (viewing?.side ?? 0)
      : selected?.key === top?.key
        ? (selected?.side ?? 0)
        : 0;
  const shown =
    top?.kind === "set" || top?.kind === "pair" ? Math.min(requestedSide, top.items.length - 1) : 0;
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
  }
  /** Takes the card off the deck and sends its judgement, which Undo can take back. */
  function commit(judgement: Judgement) {
    if (judgement.card.kind === "set" && setDraft?.key === judgement.card.key) {
      if (Object.keys(setDraft.overrides).length)
        judgement = { ...judgement, overrides: setDraft.overrides } as Judgement;
      setSetDraft(undefined);
    }
    decide(judgement.card);
    if (!quickRating || judgement.verdict !== "keep") judge.mutate(judgement);
    setHistory((previous) => [...previous, judgement]);
  }
  /** Puts the last judged card back on top and takes its judgement back. */
  function undo() {
    const last = history.at(-1);
    if (!last || busy.current) return;
    setHistory((previous) => previous.slice(0, -1));
    setPicked(null);
    const { card } = last;
    if (card.kind === "dream") returnItems([card.item]);
    else if (card.kind === "pair" || card.kind === "set") returnItems(card.items);
    restore(card);
    restoreDraft(last);
    if (!quickRating || last.verdict !== "keep") takeBack.mutate(last);
  }
  /** Flies the top card out its way, on the deck or in the preview, then commits the verdict. */
  const isPass = (choice: Verdict | PairAnswer) =>
    !quickRating && (choice === "neither" || (top?.kind !== "set" && choice === "discard"));
  const askPass = () => {
    if (!top || busy.current) return;
    setPassReason(passReasons[0]);
    setPassing(top.key);
  };
  async function act(choice: Verdict | PairAnswer, reason?: DreamPassReason) {
    if (!top || busy.current) return;
    const passReason = isPass(choice) ? (reason ?? "skip") : undefined;
    busy.current = true;
    const out = (viewing ? previewFly : fly).current;
    try {
      if (top.kind === "pair") {
        const selected = choice === "like" || choice === "keep";
        const answer = selected
          ? comparisonVotes[shown]
          : choice === "discard"
            ? "neither"
            : (choice as PairAnswer);
        if (!(answer in answerDirections)) return;
        const side = comparisonVotes.findIndex((vote) => vote === answer);
        if (side >= top.items.length) return;
        if (side >= 0) setPicked({ key: top.key, side });
        await out?.(directions[choice] ?? answerDirections[answer]);
        return commit({
          card: top,
          verdict: answer,
          passReason,
          ...(choice === "like" && { superLike: true }),
        });
      }
      if (!(choice in directions)) return;
      const likedId =
        top.kind === "set" && viewing && choice === "like" ? top.items[shown].id : undefined;
      await out?.(quickRating && choice === "like" ? "right" : directions[choice]);
      commit({
        card: top,
        verdict: choice as Verdict,
        likedId,
        passReason,
        ...(top.kind === "dream" && choice === "like" && { superLike: true }),
      });
    } finally {
      busy.current = false;
    }
  }
  /** What a swipe or arrow key in a direction means for the top card. */
  const intent = (card: DeckCard, direction: Direction): Verdict | PairAnswer | null => {
    if (quickRating)
      return ({ left: "discard", right: "like", up: null, down: null } as const)[direction];
    if (card.kind !== "pair")
      return ({ left: "discard", right: "keep", up: "like", down: null } as const)[direction];
    if (card.items.length === 3 && (direction === "left" || direction === "right")) return null;
    return comparisonSwipes[direction];
  };
  /** Arrow keys judge and U or Z undoes in the deck. */
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
    const choice = top && intent(top, direction);
    if (!choice) return;
    event.preventDefault();
    void act(choice);
  }
  const respondRef = useRef(respond);
  respondRef.current = respond;
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!layerAbove(stage.current, event)) respondRef.current(event);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The preview follows the top card, opening a comparison on its first side.
  if (viewing && !top) setViewing(null);
  else if (viewing && top && viewing.key !== top.key) setViewing({ key: top.key, side: 0 });
  else if (viewing && viewing.side !== shown) setViewing({ ...viewing, side: shown });
  const open = (card: DeckCard, side = 0) => setViewing({ key: card.key, side });
  function toggleOverride(id: string, value: SetOverride) {
    if (top?.kind !== "set" || busy.current) return;
    setSetDraft((draft) => {
      const overrides = { ...(draft?.key === top.key ? draft.overrides : undefined) };
      if (overrides[id] === value) delete overrides[id];
      else overrides[id] = value;
      return { key: top.key, overrides };
    });
  }
  /** Opens the side of a comparison pressed, or a single card. */
  const openPressed = (card: DeckCard, target: HTMLElement) =>
    open(card, Number(target.closest<HTMLElement>("[data-side]")?.dataset.side ?? 0));
  function closePreview() {
    if (!viewing || !top) return;
    const item = top.kind === "pair" ? top.items[shown] : top.item;
    // The preview mounts open, so Mantine has no opening to return focus from.
    flushSync(() => {
      if (top.kind === "pair") setSelected({ key: top.key, side: shown });
      setViewing(null);
    });
    document
      .querySelector<HTMLElement>(`[data-depth="0"] [data-preview-id="${CSS.escape(item.id)}"]`)
      ?.focus({ preventScroll: true });
  }
  /** A card in the deck, with only its top card interactive. */
  const swipeCard = (card: DeckCard) => {
    const isTop = card === top;
    const playing = isTop && !viewing;
    return (
      <SwipeCard
        key={card.key}
        depth={cards.indexOf(card)}
        paused={!playing}
        video={(card.kind === "pair" ? card.items[0] : card.item).type === "video"}
        view={
          isTop && card.kind === "set" ? (
            <Button
              variant="default"
              size="compact-sm"
              data-preview-id={card.item.id}
              onClick={() => open(card)}
            >
              View Set ({card.items.length})
            </Button>
          ) : isTop && card.kind !== "pair" ? (
            <Tooltip label="View">
              <ActionIcon
                variant="default"
                aria-label="View"
                data-preview-id={card.item.id}
                onClick={() => open(card)}
              >
                <icons.preview size={16} />
              </ActionIcon>
            </Tooltip>
          ) : undefined
        }
        fly={fly}
        comparisonSize={card.kind === "pair" ? card.items.length : undefined}
        label={cardLabel(card, isTop)}
        hints={
          card.kind === "pair"
            ? {
                ...(card.items.length === 2 && { left: "A", right: "B" }),
                up: "Accept",
                down: "Pass",
              }
            : quickRating
              ? { left: "Dislike", right: "Like" }
              : {
                  left: card.kind === "set" ? "Deny All" : "Pass",
                  right: "Accept",
                  up: "Super Like",
                }
        }
        onTap={(target) => openPressed(card, target)}
        onHold={(target) => openPressed(card, target)}
        onSwipe={(direction) => {
          const choice = intent(card, direction);
          if (!choice || card !== top || busy.current) return false;
          void act(choice);
          return true;
        }}
      >
        {card.kind === "pair" ? (
          <PairContent
            card={card}
            top={isTop}
            playing={playing}
            picked={picked?.key === card.key ? picked.side : undefined}
            shown={isTop ? shown : undefined}
            select={(side) => setSelected({ key: card.key, side })}
            view={(side) => open(card, side)}
          />
        ) : (
          <>
            <div className={classes.media}>
              <DeckMedia item={card.item} playing={playing} />
              {card.kind === "library" && !quickRating && (
                <Badge className={classes.label} variant="default">
                  Rate Your Library
                </Badge>
              )}
            </div>
            <CardText
              item={card.item}
              dreamt={card.kind !== "library"}
              title={card.kind === "set" ? card.title : undefined}
              full={sideways}
            />
          </>
        )}
      </SwipeCard>
    );
  };
  const undoButton = <DeckUndo disabled={!history.length} onClick={undo} />;
  if (!top)
    return (
      <>
        {libraryWaiting ? (
          <LoadingState fill label={quickRating ? "Loading Results" : "Loading Library"} />
        ) : (
          empty
        )}
        <Box
          ref={stage}
          role="group"
          aria-label={quickRating ? "Rating Actions" : "Dream Actions"}
          className={classes.buttons}
          mt="auto"
        >
          {undoButton}
        </Box>
      </>
    );
  return (
    <>
      <div className={classes.stage} ref={stage} aria-hidden={!!viewing} inert={!!viewing}>
        {[...cards].reverse().map(swipeCard)}
      </div>
      <DeckButtons
        card={top}
        quickRating={quickRating}
        act={(choice) => void act(choice)}
        askPass={askPass}
        hidden={!!viewing}
        leading={undoButton}
        trailing={
          viewing || quickRating ? undefined : (
            <DreamSuggestions card={top} side={shown} onMore={() => void act("more")} />
          )
        }
      />
      {!phone && !touch && (
        <Text size="xs" c="dimmed" ta="center">
          {top.kind === "pair"
            ? `${top.items.length === 2 ? "← A · → B · " : ""}↑ Accept · ↓ Pass · U Undo`
            : quickRating
              ? "← Dislike · → Like · U Undo"
              : `← ${top.kind === "set" ? "Deny All" : "Pass"} · → Accept · ↑ Super Like · U Undo`}
        </Text>
      )}
      {viewing && (
        <DreamPreview
          card={top}
          quickRating={quickRating}
          side={shown}
          setSide={(side) => open(top, side)}
          overrides={setDraft?.key === top.key ? setDraft?.overrides : undefined}
          toggleOverride={toggleOverride}
          canUndo={history.length > 0}
          close={closePreview}
          label={cardLabel(top, true)}
          fly={previewFly}
          act={(choice) => void act(choice)}
          askPass={askPass}
          undo={undo}
        />
      )}
      {passing === top.key && (
        <Modal id={passDialogId} opened onClose={closePass} title="Why Pass?" size="xs">
          <Radio.Group
            aria-label="Pass Reason"
            value={passReason}
            onChange={(value) => setPassReason(value as keyof typeof passLabels)}
          >
            <Stack gap="sm">
              {passReasons.map((reason) => (
                <Radio
                  key={reason}
                  value={reason}
                  label={passLabels[reason]}
                  data-autofocus={reason === passReason || undefined}
                />
              ))}
            </Stack>
          </Radio.Group>
          <DialogFooter onCancel={closePass}>
            <Button
              onClick={() => {
                setPassing(undefined);
                void act(top.kind === "pair" ? "neither" : "discard", passReason);
              }}
            >
              Pass
            </Button>
          </DialogFooter>
        </Modal>
      )}
    </>
  );
}
