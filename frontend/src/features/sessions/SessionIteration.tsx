import { useRef, useState, type CSSProperties } from "react";
import { Anchor, Button, Group, Image, Menu, Paper, SimpleGrid, Stack, Text } from "@mantine/core";
import { ChevronDown, FastForward } from "lucide-react";
import { icons } from "../../ui/icons";
import type { MediaItem, QueueJob, ReferenceAsset } from "../../types";
import { isProfile } from "../generation/payload";
import { ActionMenuItems, findAction } from "../gallery/ActionBar";
import { AnimateDialog, useMediaActions } from "../gallery/MediaActions";
import { useMediaTransfer } from "../gallery/mediaShare";
import { MediaTile } from "../gallery/MediaTile";
import { MediaTileActions } from "../gallery/MediaTileActions";
import { useHoldToSelect } from "../gallery/useGalleryLayout";
import { useMediaAction, type AnimateTheme } from "../gallery/useMediaAction";
import { useGenerationActions } from "../generation/GenerationProvider";
import { WritingStream } from "../generation/PromptWriting";
import { QueueJobAction, settingChips } from "../generation/Queue";
import { referenceLabel } from "../generation/references";
import { GenerationCard } from "./GenerationCard";
import { jobResults } from "./queries";
import classes from "./SessionsPage.module.css";
import { terminalStatuses } from "../../../../shared/queue";

const operationLabels = {
  image: "New image",
  refine: "Edit",
  animate: "Animate",
  upscale: "Upscale",
} as const;

/**
 * Saved results, then placeholders for outputs still generating or a run that failed. Each carries
 * the run's prompt (once written) when its record has none, so running work opens with it.
 */
export function iterationTiles(job: QueueJob): MediaItem[] {
  const prompt = String(job.input.prompt || "");
  const saved = jobResults(job)
    .filter((item) => item.status === "done" || item.url)
    .map((item) => (item.prompt ? item : { ...item, prompt }));
  const expected = terminalStatuses.has(job.status)
    ? job.status === "completed" || saved.length
      ? 0
      : 1
    : Math.max(1, Number(job.input.count) || 1) - saved.length;
  const status =
    job.status === "failed" ? "error" : job.status === "cancelled" ? "canceled" : job.status;
  return [
    ...saved,
    ...Array.from({ length: Math.max(0, expected) }, (_, index) => ({
      id: `${job.id}:pending:${index}`,
      jobId: job.id,
      index: saved.length + index,
      type: job.input.kind === "video" ? ("video" as const) : ("image" as const),
      url: "",
      status,
      prompt,
      width: Number(job.input.width) || 1024,
      height: Number(job.input.height) || 1024,
      createdAt: job.createdAt,
    })),
  ];
}

function ResultTile({
  item,
  sessionId,
  single,
  hold,
  open,
}: {
  item: MediaItem;
  sessionId: string;
  single: boolean;
  hold: ReturnType<typeof useHoldToSelect>;
  open: (item: MediaItem) => void;
}) {
  const [menu, setMenu] = useState(false);
  const width = item.width || 1024,
    height = item.height || 1024;
  return (
    <MediaTile
      item={item}
      hold={hold}
      caption="none"
      className={single ? classes.single : undefined}
      style={
        {
          aspectRatio: `${width} / ${height}`,
          "--ratio": width / height,
          // A failed or cancelled run without results stays a compact notice.
          ...(["error", "canceled"].includes(item.status) && { "--chat-media-height": "12rem" }),
        } as CSSProperties
      }
      onOpen={() => open(item)}
      onMenu={() => setMenu(true)}
      actions={
        item.status === "done" && (
          <MediaTileActions
            item={item}
            opened={menu}
            onOpenedChange={setMenu}
            sessionId={sessionId}
            omit={single ? ["edit", "animate"] : []}
          />
        )
      }
    />
  );
}

/**
 * Edit (or Extend) stages a new card below a single result; Animate ▾ (Extend ▾ on videos) offers
 * the viewer's options: motion themes run at once (after the review under Review Prompt First), Custom Animation and the composer stage a card.
 */
function ResultActions({ item, sessionId }: { item: MediaItem; sessionId: string }) {
  const action = useMediaAction(item, sessionId);
  const [animating, setAnimating] = useState<AnimateTheme | null>(null);
  const animate = findAction(
    // Only Animate is shown here, so the transfer, delete and trim parts stay idle.
    useMediaActions(item, {
      transfer: useMediaTransfer(item, false),
      sessionId,
      onAnimate: setAnimating,
      onDelete: () => {},
      onTrim: () => {},
    }),
    "animate",
  );
  const video = item.type === "video";
  return (
    <Group gap="xs">
      {!video && (
        <Button
          variant="default"
          radius="xl"
          size="compact-sm"
          leftSection={<icons.edit size={14} />}
          loading={action.isPending && action.variables === "refine"}
          disabled={action.isPending}
          onClick={() => action.mutate("refine")}
        >
          Edit
        </Button>
      )}
      {animate?.menu && (
        <Menu position="bottom-start" withinPortal>
          <Menu.Target>
            <Button
              variant="default"
              radius="xl"
              size="compact-sm"
              leftSection={video ? <FastForward size={14} /> : <icons.animate size={14} />}
              rightSection={<ChevronDown size={14} />}
              loading={animate.loading}
              disabled={animate.disabled}
            >
              {video ? "Extend" : "Animate"}
            </Button>
          </Menu.Target>
          <Menu.Dropdown miw={220}>
            {animate.note && <Menu.Label fw={400}>{animate.note}</Menu.Label>}
            <ActionMenuItems groups={animate.menu} />
          </Menu.Dropdown>
        </Menu>
      )}
      {animating && (
        <AnimateDialog
          item={item}
          sessionId={sessionId}
          theme={animating}
          onClose={() => setAnimating(null)}
        />
      )}
    </Group>
  );
}

/**
 * One generation in a Chat: the compact card (prompt, setting chips, Edit), its label, the
 * results grid and the shared result actions. Edit opens the same chip composer in place.
 */
/**
 * A long prompt shows four lines with Show More. Length decides up front, so the card keeps its height
 * from the first frame instead of growing when a measurement adds the control.
 */
function ClampedPrompt({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 320 || text.split("\n").length > 4;
  return (
    <div>
      <Text className={classes.prompt} lineClamp={long && !open ? 4 : undefined}>
        {text}
      </Text>
      {long && (
        <Anchor component="button" size="sm" onClick={() => setOpen(!open)}>
          {open ? "Show Less" : "Show More"}
        </Anchor>
      )}
    </div>
  );
}

export function SessionIteration({
  job,
  index,
  open,
  parentIndex,
}: {
  job: QueueJob;
  index: number;
  open: (item: MediaItem) => void;
  parentIndex: number;
}) {
  const [editing, setEditing] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const { profiles } = useGenerationActions();
  const tiles = iterationTiles(job);
  const hold = useHoldToSelect(tiles, undefined);
  const input = job.input;
  const profile = profiles.find(
    (candidate) => isProfile(candidate, input.profileId) && candidate.kind === input.kind,
  );
  const references = Array.isArray(input.referenceDetails)
    ? (input.referenceDetails as ReferenceAsset[])
    : [];
  const number = index + 1;
  const single = tiles.length === 1;
  const source = parentIndex >= 0 ? `iteration ${parentIndex + 1}` : "";
  // A request says whether it made a new image or edited an earlier one, and which.
  const label = [
    `Iteration ${number}`,
    ...(input.kind !== "video" && job.operation === "refine"
      ? [source ? `Editing ${source}` : "Editing a reference image"]
      : [
          input.kind === "video" && job.operation !== "upscale"
            ? "Video"
            : operationLabels[job.operation],
          source && `from ${source}`,
        ]),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Paper
      component="article"
      withBorder
      radius="lg"
      p={{ base: "sm", sm: "md" }}
      aria-label={`Iteration ${number}`}
    >
      <Stack gap="sm">
        {editing ? (
          <GenerationCard
            draft={{
              input,
              operation: job.operation === "upscale" ? "image" : job.operation,
              parentJobId: job.parentJobId,
            }}
            sourceJobId={job.id}
            sessionId={job.sessionId}
            title={`Edit Iteration ${number}`}
            request={`Edit iteration ${number}`}
            onClose={(submitted) => {
              setEditing(false);
              // Closing returns focus to Edit; a submission follows the new iteration instead.
              if (!submitted)
                requestAnimationFrame(() => editButton.current?.focus({ preventScroll: true }));
            }}
          />
        ) : (
          <>
            <ClampedPrompt text={String(input.prompt || "")} />
            <Group gap={6} justify="space-between" wrap="nowrap" align="flex-start">
              <Group gap={6} flex={1} miw={0} aria-label="Settings" role="list">
                {references.map((asset, position) => (
                  <Image
                    key={`${asset.slot}:${asset.id}`}
                    role="listitem"
                    src={asset.thumbnailUrl || asset.url}
                    alt={referenceLabel(asset, position, profile)}
                    h={26}
                    w={26}
                    radius="sm"
                  />
                ))}
                {settingChips(input, profile).map((chip) => (
                  <Text
                    key={chip}
                    role="listitem"
                    size="xs"
                    c="dimmed"
                    truncate
                    className={classes.chip}
                  >
                    {chip}
                  </Text>
                ))}
              </Group>
              {job.operation !== "upscale" && (
                <Button
                  ref={editButton}
                  variant="subtle"
                  color="gray"
                  size="compact-sm"
                  radius="xl"
                  leftSection={<icons.edit size={14} />}
                  style={{ flexShrink: 0 }}
                  aria-label={`Edit Iteration ${number}`}
                  onClick={() => setEditing(true)}
                >
                  Edit
                </Button>
              )}
            </Group>
          </>
        )}
        <Text size="xs" c="dimmed">
          {label}
        </Text>
        {job.status === "writing" && <WritingStream progress={job.progress} />}
        {tiles.length === 0 ? null : single ? (
          <ResultTile item={tiles[0]} sessionId={job.sessionId} single hold={hold} open={open} />
        ) : (
          <SimpleGrid
            cols={{ base: 2, sm: Math.min(tiles.length, 4) }}
            spacing="xs"
            className={classes.grid}
          >
            {tiles.map((item) => (
              <ResultTile
                key={item.id}
                item={item}
                sessionId={job.sessionId}
                single={false}
                hold={hold}
                open={open}
              />
            ))}
          </SimpleGrid>
        )}
        {single && tiles[0].status === "done" && (
          <ResultActions item={tiles[0]} sessionId={job.sessionId} />
        )}
        {job.status === "failed" && <QueueJobAction job={job} />}
      </Stack>
    </Paper>
  );
}
