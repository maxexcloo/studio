import {
  Anchor,
  Badge,
  Group,
  Image,
  ScrollArea,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import type { MediaItem, Profile, ReferenceAsset } from "../../types";
import { useGenerationActions } from "../generation/GenerationProvider";
import { backendLabel, isProfile, shownProfileName } from "../generation/payload";
import { loraInfoQuery } from "../generation/LoraPicker";
import { mediaTitle } from "./mediaLabels";
import { useDerivations } from "./versions";
import { WritingThinking } from "../generation/PromptWriting";
import { referenceLabel } from "../generation/references";
import classes from "./MediaViewer.module.css";
import { mediaSource } from "./mediaSource";

const fileStem = (name: unknown) =>
  String(name || "")
    .split(/[\\/]/)
    .pop()!
    .replace(/\.(safetensors|ckpt|pt|pth|bin|gguf|sft)$/i, "");
const elapsed = (ms?: number) => {
  if (ms === undefined || !Number.isFinite(ms) || ms < 0) return "";
  const seconds = Math.round(ms / 1000);
  return seconds >= 60
    ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
    : `${seconds}s`;
};
const bytes = (value = 0) => {
  if (!value) return "";
  const units = ["B", "KB", "MB", "GB"];
  const unit = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1000)));
  const scaled = value / 1000 ** unit;
  return `${scaled >= 10 || !unit ? Math.round(scaled) : scaled.toFixed(1)} ${units[unit]}`;
};
const time = (value?: string) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime())
    ? date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
    : "";
};

type Row = [label: string, value: string];
// Holds the File Size row's place while the size loads, so the table does not grow afterwards.
const pendingValue = "…";
interface Details {
  profile: string;
  loras: { name: string; strength: string }[];
  references: ReferenceAsset[];
  settings: Row[];
  output: Row[];
  timing: Row[];
}

/** The curated generation record shared by Details and Copy Settings; empty values are left out. */
function generationDetails(
  item: MediaItem,
  {
    profiles,
    loraTitle,
    size = 0,
  }: { profiles: Profile[]; loraTitle: (file: string) => string; size?: number | null },
): Details {
  const settings = item.settings || {};
  const rows = (entries: [string, unknown][]): Row[] =>
    entries
      .filter(([, value]) => value !== "" && value !== undefined && value !== null && value !== 0)
      .map(([label, value]) => [label, String(value)]);
  const sorted = (entries: [string, unknown][]): Row[] =>
    rows(entries).sort(([a], [b]) => a.localeCompare(b));
  const recorded = profiles.find((profile) => isProfile(profile, settings.profileId));
  const references = Array.isArray(settings.referenceDetails)
    ? (settings.referenceDetails as ReferenceAsset[])
    : [];
  const shown = mediaSource(item);
  const inpaint = settings.inpaint as { strength?: number } | undefined;
  const video = item.type === "video";
  return {
    profile: shownProfileName(
      String(
        settings.profileName ||
          recorded?.displayName ||
          recorded?.label ||
          fileStem(settings.modelName || (item.model?.startsWith("custom:") ? "" : item.model)),
      ),
    ),
    loras: (Array.isArray(settings.loras) ? settings.loras : [])
      .filter((lora) => lora?.name && lora.enabled !== false)
      .map((lora) => ({
        name: loraTitle(String(lora.name)),
        strength: Number(lora.strength ?? 1).toFixed(2),
      })),
    references,
    // Every recorded input, A–Z; Copy Settings copies the same rows.
    settings: sorted([
      // The backend a combined profile ran on.
      ["Backend", settings.profileBackend ? backendLabel(String(settings.profileBackend)) : ""],
      ["Text Encoder", fileStem(settings.textEncoder)],
      ["VAE", fileStem(settings.vae)],
      ["CLIP Type", settings.clipType],
      ["Weight Type", settings.weightDtype],
      ["Resolution", settings.resolution || settings.resolutionTier],
      ["Steps", settings.steps],
      ["CFG", settings.cfg],
      ["Sampler", settings.sampler],
      ["Scheduler", settings.scheduler],
      ["Denoise", !video && references.length ? settings.denoise : ""],
      ["Inpaint", inpaint?.strength ?? ""],
      ["Seed", settings.seed],
      ["Count", !video && Number(settings.count) > 1 ? settings.count : ""],
    ]),
    output: sorted([
      ["Dimensions", shown.width ? `${shown.width} × ${shown.height}` : ""],
      // An upscale's size as the model drew it.
      ["Original Size", shown.upscaled && item.width ? `${item.width} × ${item.height}` : ""],
      ["Duration", video && settings.duration ? `${settings.duration}s` : ""],
      ["Frames", video ? settings.frames : ""],
      ["FPS", video ? settings.fps : ""],
      ["File", item.outputName || item.filename],
      ["File Size", size === null ? pendingValue : bytes(size)],
      ["Time", time(item.createdAt)],
    ]),
    // The stages in the order they ran, then their totals.
    timing: rows([
      ["Queue", elapsed(item.timing?.queueMs)],
      ["Setup", elapsed(item.timing?.setupMs)],
      ["Sampling", elapsed(item.timing?.samplingMs)],
      ["Finishing", elapsed(item.timing?.finishMs)],
      ["Active", elapsed(item.timing?.runMs)],
      ["Total", elapsed(item.durationMs || undefined)],
    ]),
  };
}

function useGenerationDetails(item: MediaItem, size?: number | null) {
  const { profiles } = useGenerationActions();
  const info = useQuery(loraInfoQuery);
  return generationDetails(item, {
    profiles,
    size,
    loraTitle: (file) => info.data?.loras[file]?.title || fileStem(file),
  });
}

/** Copy Settings: the prompts and every input that was set, one per line. */
export function useSettingsText(item: MediaItem) {
  const details = useGenerationDetails(item);
  const { profiles } = useGenerationActions();
  const profile = profiles.find((candidate) => isProfile(candidate, item.settings?.profileId));
  return () =>
    [
      item.prompt?.trim(),
      item.negative?.trim() && `Negative Prompt: ${item.negative.trim()}`,
      details.profile && `Profile: ${details.profile}`,
      details.loras.length &&
        `LoRAs: ${details.loras.map((lora) => `${lora.name} ${lora.strength}`).join(", ")}`,
      details.references.length &&
        `References: ${details.references.map((asset, index) => referenceLabel(asset, index, profile)).join(", ")}`,
      ...[
        ...details.settings,
        ...details.output.filter(([label]) =>
          ["Dimensions", "Duration", "Frames", "FPS"].includes(label),
        ),
      ].map(([label, value]) => `${label}: ${value}`),
    ]
      .filter(Boolean)
      .join("\n");
}

/**
 * A prompt or caption on a subtle surface; long text scrolls within a bounded height, or `clamped`
 * shows its first two lines ending in "…".
 */
function PromptText({
  dimmed,
  clamped,
  children,
}: {
  dimmed?: boolean;
  clamped?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className={classes.promptText}>
      <ScrollArea.Autosize mah="12rem">
        <Text
          size="sm"
          c={dimmed ? "dimmed" : undefined}
          lineClamp={clamped ? 2 : undefined}
          style={{ whiteSpace: "pre-wrap" }}
        >
          {children}
        </Text>
      </ScrollArea.Autosize>
    </div>
  );
}

/** The shown file's size from a one-byte range request; gallery records do not store it. */
function useMediaSize(url: string) {
  return useQuery({
    queryKey: ["media-size", url],
    enabled: Boolean(url),
    staleTime: Infinity,
    queryFn: async ({ signal }) => {
      const response = await fetch(url, { headers: { Range: "bytes=0-0" }, signal });
      const range = Number(response.headers.get("content-range")?.match(/\/(\d+)\s*$/)?.[1]);
      if (range) return range;
      if (/^(data|blob):/i.test(url)) return (await response.blob()).size;
      return response.status === 200 ? Number(response.headers.get("content-length")) || 0 : 0;
    },
  });
}

/** One Details section: its heading, with any `action` at its end, over its content. */
function DetailSection({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Stack gap={6}>
      <Group justify="space-between" wrap="nowrap">
        <Title order={6}>{title}</Title>
        {action}
      </Group>
      {children}
    </Stack>
  );
}

/** The gallery caption in the prompt's style, expanded until Show Less folds it to two lines. */
function Caption({ item }: { item: MediaItem }) {
  // Two lines until asked for the rest, so the prompt below stays in view.
  const [open, setOpen] = useState(false);
  const caption = item.caption;
  if (!caption?.text && !caption?.tags?.length) return null;
  return (
    <DetailSection
      title="Caption"
      action={
        <Anchor
          component="button"
          type="button"
          size="xs"
          c="dimmed"
          onClick={() => setOpen(!open)}
        >
          {open ? "Show Less" : "Show More"}
        </Anchor>
      }
    >
      {caption.text && <PromptText clamped={!open}>{caption.text}</PromptText>}
      {open && !!caption.tags?.length && (
        <Group gap={4} aria-label="Caption Tags">
          {[...caption.tags]
            .sort((a, b) => a.localeCompare(b))
            .map((tag) => (
              <Badge
                key={tag}
                component={Link}
                to={`${item.type === "video" ? "/video" : "/images"}?q=${encodeURIComponent(tag)}`}
                aria-label={`Search ${tag}`}
                variant="default"
                radius="sm"
                size="sm"
                fw={400}
                style={{ cursor: "pointer" }}
              >
                {tag}
              </Badge>
            ))}
        </Group>
      )}
    </DetailSection>
  );
}

/** Details › Prompt, with the prompt's thinking and any negative prompt. */
function DetailsPrompt({ item }: { item: MediaItem }) {
  return (
    <DetailSection title="Prompt">
      <PromptText>{item.prompt || "No prompt recorded."}</PromptText>
      <WritingThinking writing={item.writing} />
      {item.negative && <PromptText dimmed>Negative: {item.negative}</PromptText>}
    </DetailSection>
  );
}

/** Label and value rows, the label column dimmed. */
function Section({ title, rows }: { title: string; rows: Row[] }) {
  if (!rows.length) return null;
  return (
    <DetailSection title={title}>
      <Table
        variant="vertical"
        layout="fixed"
        withRowBorders={false}
        verticalSpacing={4}
        horizontalSpacing={0}
      >
        <Table.Tbody>
          {rows.map(([label, value]) => (
            <Table.Tr key={label}>
              <Table.Th w={96} bg="transparent" fw={400} c="dimmed">
                {label}
              </Table.Th>
              <Table.Td
                c={value === pendingValue ? "dimmed" : undefined}
                style={{ overflowWrap: "anywhere" }}
              >
                {value}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </DetailSection>
  );
}

/** Links to the results an item was made from or made, opening each in the viewer when it can. */
function Related({
  title,
  items,
  open,
}: {
  title: string;
  items: MediaItem[];
  open?: (item: MediaItem) => void;
}) {
  if (!items.length) return null;
  return (
    <DetailSection title={title}>
      {items.map((related) =>
        open ? (
          <Anchor
            key={related.id}
            component="button"
            type="button"
            size="sm"
            ta="left"
            onClick={() => open(related)}
          >
            {mediaTitle(related)}
          </Anchor>
        ) : (
          <Text key={related.id} size="sm">
            {mediaTitle(related)}
          </Text>
        ),
      )}
    </DetailSection>
  );
}

/**
 * Details › Caption, Prompt, Source, From, Derived, Model, LoRAs, References, Settings, Output and Timing
 * for one result; From and Derived look among the `loaded` items too, and `open` shows one in the
 * viewer.
 */
export function MediaDetails({
  item,
  related: loaded,
  open,
}: {
  item: MediaItem;
  related?: MediaItem[];
  open?: (item: MediaItem) => void;
}) {
  const related = useDerivations(item, loaded);
  const url = item.status === "done" ? mediaSource(item).url : "";
  const size = useMediaSize(url);
  const details = useGenerationDetails(item, url && size.isPending ? null : size.data);
  const { profiles } = useGenerationActions();
  const profile = profiles.find((candidate) => isProfile(candidate, item.settings?.profileId));
  return (
    <Stack gap="lg" fz="sm">
      <Caption item={item} />
      <DetailsPrompt item={item} />
      {item.source && (
        <DetailSection title="Source">
          <Anchor href={item.source.url} target="_blank" rel="noreferrer" size="sm">
            {item.source.title || item.source.url}
          </Anchor>
        </DetailSection>
      )}
      <Related title="From" items={related.source ? [related.source] : []} open={open} />
      <Related title="Derived" items={related.derived} open={open} />
      {details.profile && (
        <DetailSection title="Model">
          <Text size="sm">{details.profile}</Text>
        </DetailSection>
      )}
      {!!details.loras.length && (
        <DetailSection title="LoRAs">
          {details.loras.map((lora) => (
            <Group key={lora.name} justify="space-between" wrap="nowrap" gap="xs">
              <Text size="sm" truncate>
                {lora.name}
              </Text>
              <Badge variant="default" radius="sm" style={{ flexShrink: 0 }}>
                {lora.strength}
              </Badge>
            </Group>
          ))}
        </DetailSection>
      )}
      {!!details.references.length && (
        <DetailSection title="References">
          <Group gap="xs">
            {details.references.map((asset, index) => (
              <Tooltip
                key={`${asset.slot}:${asset.id}`}
                label={referenceLabel(asset, index, profile)}
              >
                <Image
                  src={asset.thumbnailUrl || asset.url}
                  alt={referenceLabel(asset, index, profile)}
                  w={48}
                  h={48}
                  radius="sm"
                  fallbackSrc=""
                />
              </Tooltip>
            ))}
          </Group>
        </DetailSection>
      )}
      <Section title="Settings" rows={details.settings} />
      <Section title="Output" rows={details.output} />
      <Section title="Timing" rows={details.timing} />
    </Stack>
  );
}
