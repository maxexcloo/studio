import { useRef, useState, type CSSProperties } from "react";
import { Anchor, Badge, Button, Group, Image, Paper, SimpleGrid, Stack, Text } from "@mantine/core";
import { Pencil, Play } from "lucide-react";
import type { MediaItem, Profile, QueueJob, ReferenceAsset } from "../../types";
import { isProfile } from "../generation/payload";
import { MediaTile } from "../gallery/MediaTile";
import { MediaTileActions } from "../gallery/MediaTileActions";
import { useHoldToSelect } from "../gallery/useGalleryLayout";
import { useMediaAction } from "../gallery/useMediaAction";
import { useGenerationActions } from "../generation/GenerationProvider";
import { QueueJobAction, terminal } from "../generation/Queue";
import { referenceLabel } from "../generation/references";
import { GenerationCard } from "./GenerationCard";
import { jobResults } from "./queries";
import classes from "./SessionsPage.module.css";

const operationLabels = {
  image: "Image",
  refine: "Refine",
  animate: "Animate",
  upscale: "Upscale",
} as const;

/** The compact card's setting chips: only what the run recorded, without repeating the profile. */
function settingChips(input: QueueJob["input"], profile?: Profile) {
  const name = String(input.profileName || profile?.displayName || profile?.label || "");
  const steps = input.steps && !new RegExp(`\\b${input.steps}\\s*steps?\\b`, "i").test(name);
  const loras = Array.isArray(input.loras)
    ? input.loras.filter((lora: { enabled?: boolean }) => lora.enabled !== false)
    : [];
  const seconds = Number(input.duration) || Number(input.frames) / Number(input.fps) || 0;
  return [
    name,
    input.width && input.height ? `${input.width} × ${input.height}` : "",
    input.kind === "video" && seconds ? `${Math.round(seconds * 10) / 10} s` : "",
    steps ? `${input.steps} Steps` : "",
    input.seed !== undefined && input.seed !== "" ? `Seed ${input.seed}` : "",
    loras.length ? `${loras.length} ${loras.length === 1 ? "LoRA" : "LoRAs"}` : "",
    Number(input.count) > 1 ? `${input.count} Outputs` : "",
  ].filter(Boolean);
}

/** Saved results, then placeholders for outputs still generating or a run that failed. */
function iterationTiles(job: QueueJob): MediaItem[] {
  const saved = jobResults(job).filter((item) => item.status === "done" || item.url);
  const expected = terminal.has(job.status)
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
      type: job.input.kind === "video" ? ("video" as const) : ("image" as const),
      url: "",
      status,
      prompt: String(job.input.prompt || ""),
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
      onOpen={() => item.status === "done" && open(item)}
      onMenu={() => setMenu(true)}
      actions={
        item.status === "done" && (
          <MediaTileActions
            item={item}
            opened={menu}
            onOpenedChange={setMenu}
            sessionId={sessionId}
            omit={single ? ["refine", "animate"] : []}
          />
        )
      }
    />
  );
}

/** Refine (or Extend) and Animate stage a new card below for a single result. */
function ResultActions({ item, sessionId }: { item: MediaItem; sessionId: string }) {
  const action = useMediaAction(item, sessionId);
  return (
    <Group gap="xs">
      <Button
        variant="default"
        radius="xl"
        size="compact-md"
        leftSection={<Pencil size={14} />}
        loading={action.isPending && action.variables !== "animate"}
        disabled={action.isPending}
        onClick={() => action.mutate(item.type === "video" ? "extend" : "refine")}
      >
        {item.type === "video" ? "Extend" : "Refine"}
      </Button>
      {item.type === "image" && (
        <Button
          variant="default"
          radius="xl"
          size="compact-md"
          leftSection={<Play size={14} />}
          loading={action.isPending && action.variables === "animate"}
          disabled={action.isPending}
          onClick={() => action.mutate("animate")}
        >
          Animate
        </Button>
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
  const label = [
    `Iteration ${number}`,
    input.kind === "video" && job.operation !== "upscale"
      ? "Video"
      : operationLabels[job.operation],
    parentIndex >= 0 ? `from iteration ${parentIndex + 1}` : "",
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
                  <Badge
                    key={chip}
                    role="listitem"
                    variant="default"
                    radius="xl"
                    size="lg"
                    tt="none"
                    fw={500}
                    className={classes.chip}
                  >
                    {chip}
                  </Badge>
                ))}
              </Group>
              {job.operation !== "upscale" && (
                <Button
                  ref={editButton}
                  variant="subtle"
                  color="gray"
                  size="compact-md"
                  radius="xl"
                  leftSection={<Pencil size={14} />}
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
