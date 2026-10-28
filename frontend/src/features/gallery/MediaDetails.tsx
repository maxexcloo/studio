import {
  ActionIcon,
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
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import { Copy, ListChecks } from "lucide-react";
import type { MediaItem, Profile, ReferenceAsset } from "../../types";
import { copyText } from "../../ui/clipboard";
import { useGenerationActions } from "../generation/GenerationProvider";
import { backendLabel, isProfile } from "../generation/payload";
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
// Holds the Size row's place while the size loads, so the table does not grow afterwards.
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
  const recorded = profiles.find((profile) => isProfile(profile, settings.profileId));
  const references = Array.isArray(settings.referenceDetails)
    ? (settings.referenceDetails as ReferenceAsset[])
    : [];
  const shown = mediaSource(item);
  const inpaint = settings.inpaint as { strength?: number } | undefined;
  const video = item.type === "video";
  return {
    profile: String(
      settings.profileName ||
        recorded?.displayName ||
        recorded?.label ||
        fileStem(settings.modelName || (item.model?.startsWith("custom:") ? "" : item.model)),
    ),
    loras: (Array.isArray(settings.loras) ? settings.loras : [])
      .filter((lora) => lora?.name && lora.enabled !== false)
      .map((lora) => ({
        name: loraTitle(String(lora.name)),
        strength: Number(lora.strength ?? 1).toFixed(2),
      })),
    references,
    // Every recorded input, in the order they shape the run; Copy Settings copies the same rows.
    settings: rows([
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
    output: rows([
      ["Dimensions", shown.width ? `${shown.width} × ${shown.height}` : ""],
      ["Drawn At", shown.upscaled && item.width ? `${item.width} × ${item.height}` : ""],
      ["Duration", video && settings.duration ? `${settings.duration}s` : ""],
      ["Frames", video ? settings.frames : ""],
      ["FPS", video ? settings.fps : ""],
      ["File", item.outputName || item.filename],
      ["Size", size === null ? pendingValue : bytes(size)],
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

/** A prompt on a subtle surface; long prompts scroll within a bounded height. */
function PromptText({ dimmed, children }: { dimmed?: boolean; children: React.ReactNode }) {
  return (
    <div className={classes.promptText}>
      <ScrollArea.Autosize mah="12rem">
        <Text size="sm" c={dimmed ? "dimmed" : undefined} style={{ whiteSpace: "pre-wrap" }}>
          {children}
        </Text>
      </ScrollArea.Autosize>
    </div>
  );
}

/** Copy Prompt and Copy Settings beside the details title. */
export function DetailsCopyActions({ item }: { item: MediaItem }) {
  const settingsText = useSettingsText(item);
  return (
    <Group gap={6} wrap="nowrap">
      {item.prompt && (
        <Tooltip label="Copy Prompt">
          <ActionIcon
            variant="default"
            aria-label="Copy Prompt"
            onClick={() => void copyText(item.prompt!, "Prompt")}
          >
            <Copy size={18} />
          </ActionIcon>
        </Tooltip>
      )}
      <Tooltip label="Copy Settings">
        <ActionIcon
          variant="default"
          aria-label="Copy Settings"
          onClick={() => void copyText(settingsText(), "Settings")}
        >
          <ListChecks size={18} />
        </ActionIcon>
      </Tooltip>
    </Group>
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

function Section({ title, rows }: { title: string; rows: Row[] }) {
  if (!rows.length) return null;
  return (
    <Stack gap={6}>
      <Title order={6}>{title}</Title>
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
    </Stack>
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
    <Stack gap={6}>
      <Title order={6}>{title}</Title>
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
    </Stack>
  );
}

/**
 * Details › Caption, Prompt, From, Derived, Model, LoRAs, References, Settings, Output and Timing
 * for one result; `open` shows a related result in the viewer.
 */
export function MediaDetails({
  item,
  open,
}: {
  item: MediaItem;
  open?: (item: MediaItem) => void;
}) {
  const related = useDerivations(item);
  const url = item.status === "done" ? mediaSource(item).url : "";
  const size = useMediaSize(url);
  const details = useGenerationDetails(item, url && size.isPending ? null : size.data);
  const { profiles } = useGenerationActions();
  const profile = profiles.find((candidate) => isProfile(candidate, item.settings?.profileId));
  return (
    <Stack gap="lg" fz="sm">
      {(item.caption?.text || !!item.caption?.tags?.length) && (
        <Stack gap={6}>
          <Title order={6}>Caption</Title>
          {item.caption?.text && <Text size="sm">{item.caption.text}</Text>}
          {!!item.caption?.tags?.length && (
            <Group gap={4} aria-label="Caption Tags">
              {[...item.caption.tags]
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
                    tt="none"
                    fw={400}
                    style={{ cursor: "pointer" }}
                  >
                    {tag}
                  </Badge>
                ))}
            </Group>
          )}
        </Stack>
      )}
      <Stack gap={6}>
        <Title order={6}>Prompt</Title>
        <PromptText>{item.prompt || "No prompt recorded."}</PromptText>
        <WritingThinking writing={item.writing} />
        {item.negative && <PromptText dimmed>Negative: {item.negative}</PromptText>}
      </Stack>
      <Related title="From" items={related.source ? [related.source] : []} open={open} />
      <Related title="Derived" items={related.derived} open={open} />
      {details.profile && (
        <Stack gap={6}>
          <Title order={6}>Model</Title>
          <Text size="sm">{details.profile}</Text>
        </Stack>
      )}
      {!!details.loras.length && (
        <Stack gap={6}>
          <Title order={6}>LoRAs</Title>
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
        </Stack>
      )}
      {!!details.references.length && (
        <Stack gap={6}>
          <Title order={6}>References</Title>
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
        </Stack>
      )}
      <Section title="Settings" rows={details.settings} />
      <Section title="Output" rows={details.output} />
      <Section title="Timing" rows={details.timing} />
    </Stack>
  );
}
