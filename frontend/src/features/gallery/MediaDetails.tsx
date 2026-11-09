import {
  ActionIcon,
  Anchor,
  Badge,
  Group,
  Image,
  Spoiler,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { Link } from "react-router";
import type { MediaItem, Profile } from "../../types";
import { useCopy } from "../../ui/clipboard";
import { icons } from "../../ui/icons";
import { useGenerationActions } from "../generation/GenerationProvider";
import { backendLabel, isProfile, shownProfileName } from "../generation/payload";
import { loraInfoQuery } from "../generation/LoraPicker";
import { mediaTitle } from "./mediaLabels";
import { useDerivations } from "./versions";
import { WritingThinking } from "../generation/PromptWriting";
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
/** A reference the run took: the role it ran as and, where recorded, how strongly it applied. */
interface RanReference {
  id: string;
  role: string;
  strength: string;
}
// Holds the File Size row's place while the size loads, so the table does not grow afterwards.
const pendingValue = "…";
interface Details {
  profile: string;
  loras: { name: string; strength: string }[];
  references: RanReference[];
  /** What was supplied but did not reach the run. */
  unused: string[];
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
  const shown = mediaSource(item);
  const inpaint = settings.inpaint as { strength?: number } | undefined;
  const video = item.type === "video";
  const staged = (Array.isArray(settings.referenceAssets) ? settings.referenceAssets : []).filter(
    (reference): reference is { slot?: string; assetId: string } => Boolean(reference?.assetId),
  );
  const guides = !inpaint && settings.referenceRole === "reference";
  const slots = recorded?.mediaInputs || [];
  // The reference a run frames and edits: the start slot's, else the first.
  const primarySlot = (slots.find((slot) => slot.role === "start") || slots[0])?.id;
  const primary = staged.find((reference) => reference.slot === primarySlot) || staged[0];
  const denoise = Number(settings.denoise);
  const references = staged.map(({ slot, assetId: id }, index): RanReference => {
    // A video's frames read by their slot, such as First Frame; an unlabelled one by its ID.
    const named =
      slots.find((input) => input.id === slot)?.label ||
      String(slot || "").replace(/^\w/, (letter) => letter.toUpperCase());
    if (video) return { id, role: named || `Reference ${index + 1}`, strength: "" };
    if (staged[index] !== primary || guides)
      return { id, role: `Reference ${index + 1}`, strength: "Guides the picture" };
    if (inpaint)
      return {
        id,
        role: "Edit Source · Masked",
        strength: inpaint.strength === undefined ? "" : `Inpaint ${inpaint.strength}`,
      };
    return { id, role: "Edit Source", strength: denoise > 0 ? `Denoise ${denoise}` : "" };
  });
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
    unused: settings.maskSkipped
      ? ["Mask: nothing in it was painted, so this ran as an edit of the whole picture."]
      : [],
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
      // A picture's mode, named as the composer's Reference Role chips name it.
      [
        "Mode",
        video
          ? ""
          : !staged.length
            ? "Generate"
            : inpaint
              ? "Inpaint"
              : guides
                ? "Reference"
                : "Edit",
      ],
      ["Denoise", !video && staged.length ? settings.denoise : ""],
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

const referenceText = ({ role, strength }: RanReference) =>
  strength ? `${role} (${strength})` : role;

/** Copy Settings: the prompts and every input that was set, one per line. */
export function useSettingsText(item: MediaItem) {
  const details = useGenerationDetails(item);
  return () =>
    [
      item.prompt?.trim(),
      item.negative?.trim() && `Negative Prompt: ${item.negative.trim()}`,
      details.profile && `Profile: ${details.profile}`,
      details.loras.length &&
        `LoRAs: ${details.loras.map((lora) => `${lora.name} ${lora.strength}`).join(", ")}`,
      details.references.length &&
        `References: ${details.references.map(referenceText).join(", ")}`,
      ...details.unused.map((note) => `Not Used: ${note}`),
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

/** A prompt or caption with its line breaks. */
function DetailText({ children }: { children: React.ReactNode }) {
  return (
    <Text size="sm" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
      {children}
    </Text>
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

/**
 * One Details section: its heading and Copy, which copies `copy`, over its content; content taller
 * than a few lines folds until Expand. Any `after` (the prompt's thinking) stays outside the fold.
 */
function DetailSection({
  title,
  copy,
  after,
  children,
}: {
  title: string;
  copy: string;
  after?: React.ReactNode;
  children: React.ReactNode;
}) {
  const copier = useCopy();
  return (
    <Stack gap={6}>
      <Group justify="space-between" wrap="nowrap">
        <Title order={6}>{title}</Title>
        <Tooltip label={copier.copied ? "Copied" : `Copy ${title}`}>
          <ActionIcon
            size="sm"
            variant="subtle"
            color="gray"
            aria-label={`Copy ${title}`}
            disabled={!copy}
            onClick={() => copier.copy(copy)}
          >
            {copier.copied ? <Check size={14} /> : <icons.copy size={14} />}
          </ActionIcon>
        </Tooltip>
      </Group>
      <Spoiler
        maxHeight={120}
        showLabel="Expand"
        hideLabel="Collapse"
        showAriaLabel={`Expand ${title}`}
        hideAriaLabel={`Collapse ${title}`}
      >
        <Stack gap={6}>{children}</Stack>
      </Spoiler>
      {after}
    </Stack>
  );
}

/** Label and value lines, as a section copies its rows. */
const rowsText = (rows: Row[]) =>
  rows
    .filter(([, value]) => value !== pendingValue)
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");

/** The gallery caption in the prompt's style, then its tags. */
function Caption({ item }: { item: MediaItem }) {
  const caption = item.caption;
  if (!caption?.text && !caption?.tags?.length) return null;
  const tags = [...(caption.tags || [])].sort((a, b) => a.localeCompare(b));
  return (
    <DetailSection
      title="Caption"
      copy={[caption.text, tags.join(", ")].filter(Boolean).join("\n")}
    >
      {caption.text && <DetailText>{caption.text}</DetailText>}
      {!!tags.length && (
        <Group gap={4} aria-label="Caption Tags">
          {tags.map((tag) => (
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

/** Details › Prompt with the prompt's thinking, then any Negative Prompt as its own section. */
function DetailsPrompt({ item }: { item: MediaItem }) {
  return (
    <>
      <DetailSection
        title="Prompt"
        copy={item.prompt || ""}
        after={<WritingThinking writing={item.writing} />}
      >
        <DetailText>{item.prompt || "No prompt recorded."}</DetailText>
      </DetailSection>
      {item.negative && (
        <DetailSection title="Negative Prompt" copy={item.negative}>
          <DetailText>{item.negative}</DetailText>
        </DetailSection>
      )}
    </>
  );
}

/** Label and value rows, the label column dimmed. */
function Section({ title, rows }: { title: string; rows: Row[] }) {
  if (!rows.length) return null;
  return (
    <DetailSection title={title} copy={rowsText(rows)}>
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

/**
 * The result a reference was taken from, when it is among `items`: a gallery reference's ID holds
 * its result's address (backend/references.js), before any frame suffix.
 */
function galleryReference(id: string, items: MediaItem[]) {
  const encoded = /^gallery:([\w-]+)/.exec(id)?.[1];
  if (!encoded) return;
  const key = atob(encoded.replace(/-/g, "+").replace(/_/g, "/"));
  return items.find((candidate) => candidate.url === key || candidate.id === key);
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
    <DetailSection title={title} copy={items.map(mediaTitle).join("\n")}>
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
 * Details › Caption (with its tags), From, Prompt, Negative Prompt, Source, Derived, Model, LoRAs,
 * References, Settings, Output and Timing for one result; From and Derived look among the `loaded`
 * items too, and `open` shows a related result in the
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
  return (
    <Stack gap="lg" fz="sm">
      <Caption item={item} />
      <Related title="From" items={related.source ? [related.source] : []} open={open} />
      <DetailsPrompt item={item} />
      {item.source && (
        <DetailSection title="Source" copy={item.source.url}>
          <Anchor href={item.source.url} target="_blank" rel="noreferrer" size="sm">
            {item.source.title || item.source.url}
          </Anchor>
        </DetailSection>
      )}
      <Related title="Derived" items={related.derived} open={open} />
      {details.profile && (
        <DetailSection title="Model" copy={details.profile}>
          <Text size="sm">{details.profile}</Text>
        </DetailSection>
      )}
      {!!details.loras.length && (
        <DetailSection
          title="LoRAs"
          copy={details.loras.map((lora) => `${lora.name} ${lora.strength}`).join("\n")}
        >
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
      {!!(details.references.length || details.unused.length) && (
        <DetailSection
          title="References"
          copy={[
            ...details.references.map(referenceText),
            ...details.unused.map((note) => `Not used: ${note}`),
          ].join("\n")}
        >
          {details.references.map((reference) => {
            const address = `/api/reference-assets/${encodeURIComponent(reference.id)}`;
            const source = galleryReference(reference.id, [
              ...(loaded || []),
              ...(related.source ? [related.source] : []),
            ]);
            const thumbnail = (
              <Image src={`${address}/thumbnail`} alt="" w={48} h={48} radius="sm" fallbackSrc="" />
            );
            // A result in the gallery opens in the viewer; any other picture in a new tab.
            return (
              <Group key={`${reference.role}:${reference.id}`} gap="sm" wrap="nowrap">
                {source && open ? (
                  <UnstyledButton
                    aria-label={`Open ${reference.role}`}
                    onClick={() => open(source)}
                  >
                    {thumbnail}
                  </UnstyledButton>
                ) : (
                  <UnstyledButton
                    component="a"
                    href={`${address}/media`}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Open ${reference.role}`}
                  >
                    {thumbnail}
                  </UnstyledButton>
                )}
                <Stack gap={0}>
                  <Text size="sm">{reference.role}</Text>
                  {reference.strength && (
                    <Text size="xs" c="dimmed">
                      {reference.strength}
                    </Text>
                  )}
                </Stack>
              </Group>
            );
          })}
          {details.unused.map((note) => (
            <Text key={note} size="sm" c="yellow">
              Not used: {note}
            </Text>
          ))}
        </DetailSection>
      )}
      <Section title="Settings" rows={details.settings} />
      <Section title="Output" rows={details.output} />
      <Section title="Timing" rows={details.timing} />
    </Stack>
  );
}
