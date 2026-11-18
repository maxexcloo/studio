import {
  ActionIcon,
  Anchor,
  Badge,
  Button,
  Group,
  Image,
  Stack,
  Table,
  Text,
  Title,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { queryOptions, useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";

import { titleCase } from "../../../../shared/titles";
import { api } from "../../api";
import type { MediaItem, Profile } from "../../types";
import { formatBytes } from "../../ui/bytes";
import { useCopy } from "../../ui/clipboard";
import { compareNames } from "../../ui/DataTable";
import { formatDateTime } from "../../ui/dates";
import { icons } from "../../ui/icons";
import { useGroupFeature } from "../auth/AccountGate";
import { identityNote } from "../characters/identity";
import { charactersQuery, promptCardsQuery } from "../characters/queries";
import { useStartCard } from "../characters/useCardFrom";
import { comparisonMembersQuery, comparisonOf } from "../compare/queries";
import { useGenerationActions } from "../generation/GenerationProvider";
import { loraInfoQuery } from "../generation/LoraPicker";
import { backendLabel, isProfile, profileName, shownProfileName } from "../generation/payload";
import { WritingThinking } from "../generation/PromptWriting";
import { queueQuery } from "../generation/Queue";
import { referenceAssetQuery } from "../generation/references";
import { mediaNumber, mediaTitle } from "./mediaLabels";
import { mediaSource } from "./mediaSource";
import { derivations } from "./versions";
import { type GalleryState, galleryPath, viewerPath } from "./viewerLink";

import classes from "./MediaDetails.module.css";

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
const time = (value?: string) => {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? formatDateTime(date) : "";
};
/** The recorded profile's readable name, then the current profile's, then the model file's. */
const recordedModel = (item: MediaItem, profiles: Profile[]) => {
  const settings = item.settings || {};
  const recorded = profiles.find((profile) => isProfile(profile, settings.profileId));
  if (!settings.profileName && recorded) return profileName(recorded);
  return shownProfileName(
    String(
      settings.profileName ||
        fileStem(
          settings.modelName ||
            settings.model ||
            (item.model?.startsWith("custom:") ? "" : item.model),
        ),
    ),
  );
};

/** When it was made, its size and a video's length, under the title in the panel and phone sheet. */
export function MediaDetailsMetadata({ item }: { item: MediaItem }) {
  const source = mediaSource(item);
  const created = time(item.createdAt);
  const settings = item.settings || {};
  const seconds =
    Number(settings.duration) || Number(settings.frames) / Number(settings.fps) || undefined;
  const line = [
    created && `${item.uploaded ? "Uploaded " : ""}${created}`,
    source.width ? `${source.width} × ${source.height}` : "",
    item.type === "video" && seconds ? `${Math.round(seconds * 10) / 10}s` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    line && (
      <Text size="xs" c="dimmed">
        {line}
      </Text>
    )
  );
}

type Row = [label: string, value: string];
const sortRows = <T extends [string, unknown]>(rows: T[]) =>
  [...rows].sort(([a], [b]) => compareNames(a, b));
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
  const recorded = profiles.find((profile) => isProfile(profile, settings.profileId));
  const shown = mediaSource(item);
  const inpaint = settings.inpaint as { strength?: number } | undefined;
  const video = item.type === "video";
  // Radiance runs its own text encoder, VAE and sampler, so ComfyUI's recorded choices don't apply.
  const comfyui = (value: unknown) => (settings.profileBackend === "radiance" ? "" : value);
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
    const named = slots.find((input) => input.id === slot)?.label || titleCase(String(slot || ""));
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
    profile: recordedModel(item, profiles),
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
    // Every recorded input, which Details and Copy Settings both list A–Z.
    settings: rows([
      // The backend a combined profile ran on.
      ["Backend", settings.profileBackend ? backendLabel(String(settings.profileBackend)) : ""],
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
      ["Steps", settings.steps],
      ["CFG", settings.cfg],
      ["Sampler", comfyui(settings.sampler)],
      ["Scheduler", comfyui(settings.scheduler)],
      ["Rebalance", titleCase(String(settings.rebalance || ""))],
      ["Denoise", !video && staged.length ? settings.denoise : ""],
      ["Inpaint", inpaint?.strength ?? ""],
      ["Seed", settings.seed],
      ["Count", !video && Number(settings.count) > 1 ? settings.count : ""],
      ["Resolution", settings.resolution || settings.resolutionTier],
      ["Quality", titleCase(String(settings.quality || ""))],
      ["Text Encoder", comfyui(fileStem(settings.textEncoder))],
      ["VAE", comfyui(fileStem(settings.vae))],
      ["CLIP Type", comfyui(settings.clipType)],
      ["Weight Type", comfyui(settings.weightDtype)],
    ]),
    output: rows([
      ["Dimensions", shown.width ? `${shown.width} × ${shown.height}` : ""],
      // An upscale's size as the model drew it.
      ["Original Size", shown.upscaled && item.width ? `${item.width} × ${item.height}` : ""],
      // A stopped upscale leaves the picture at the size it was made.
      ["Upscale", item.upscale?.status === "cancelled" ? "Cancelled" : ""],
      ["Duration", video && settings.duration ? `${settings.duration}s` : ""],
      ["Frames", video ? settings.frames : ""],
      ["FPS", video ? settings.fps : ""],
      ["File", item.outputName || item.filename],
      ["File Size", size === null ? pendingValue : formatBytes(size)],
      ["Time", time(item.createdAt)],
      ["Result", mediaNumber(item)],
    ]),
    // The stages in the order they ran, then their totals.
    timing: rows([
      ["Queue", elapsed(item.timing?.queueMs)],
      ["Setup", elapsed(item.timing?.setupMs)],
      ["Model Load", elapsed(item.timing?.loadMs)],
      ["Sampling", elapsed(item.timing?.samplingMs)],
      ["Download", elapsed(item.timing?.downloadMs)],
      ["Finishing", elapsed(item.timing?.finishMs)],
      ["Saving", elapsed(item.timing?.saveMs)],
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
      time(item.createdAt) && `${item.uploaded ? "Uploaded" : "Created"}: ${time(item.createdAt)}`,
      details.profile && `Profile: ${details.profile}`,
      details.loras.length &&
        `LoRAs: ${details.loras.map((lora) => `${lora.name} ${lora.strength}`).join(", ")}`,
      details.references.length &&
        `References: ${details.references.map(referenceText).join(", ")}`,
      ...details.unused.map((note) => `Not Used: ${note}`),
      ...sortRows([
        ...details.settings,
        ...details.output.filter(([label]) =>
          ["Dimensions", "Duration", "Frames", "FPS"].includes(label),
        ),
      ]).map(([label, value]) => `${label}: ${value}`),
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
 * One Details section: its heading over its content, shown in full. Prompt and Negative Prompt take
 * a Copy beside the heading, which copies `copy`. Any `after` (the prompt's thinking) follows.
 */
function DetailSection({
  title,
  copy,
  after,
  children,
}: {
  title: string;
  copy?: string;
  after?: React.ReactNode;
  children: React.ReactNode;
}) {
  const copier = useCopy();
  return (
    <Stack gap={6}>
      <Group justify="space-between" wrap="nowrap">
        <Title order={6}>{title}</Title>
        {copy !== undefined && (
          <Tooltip label={copier.copied ? "Copied" : `Copy ${title}`}>
            {/* Hung over the heading's line, so it adds no height to the section. */}
            <ActionIcon
              size="sm"
              my={-6}
              variant="subtle"
              color="gray"
              aria-label={`Copy ${title}`}
              disabled={!copy}
              onClick={() => copier.copy(copy)}
            >
              {copier.copied ? <Check size={14} /> : <icons.copy size={14} />}
            </ActionIcon>
          </Tooltip>
        )}
      </Group>
      {children}
      {after}
    </Stack>
  );
}

/** A part's name within its section, such as a card's kind under References. */
function PartLabel({ children }: { children: React.ReactNode }) {
  return (
    <Text size="xs" c="dimmed">
      {children}
    </Text>
  );
}

/**
 * Output › Face Check's finding for a result made with a character, naming the character, and
 * whether it is the automatic redo of a result whose face drifted.
 */
function FaceCheck({ identity, faceRedo }: Pick<MediaItem, "identity" | "faceRedo">) {
  const characters = useQuery(charactersQuery);
  const name =
    characters.data?.find((card) => card.id === identity?.characterId)?.name || "the character";
  return (
    <Stack gap={2}>
      {identity && (
        <Text span inherit c={identity.drifted ? "orange" : undefined}>
          {identityNote(identity, name)}
        </Text>
      )}
      {faceRedo && (
        <Text span inherit>
          Redone automatically after the face drifted.
        </Text>
      )}
    </Stack>
  );
}

/**
 * A caption folds to five lines when longer, its last line fading out under Expand at its end (WebKit
 * drops a clamped text's lines around a floated control); expanded, Collapse follows its last word.
 */
function CaptionText({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [long, setLong] = useState(false);
  const [expanded, setExpanded] = useState(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || expanded) return;
    const measure = () => setLong(element.scrollHeight > element.clientHeight + 1);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text, expanded]);
  const toggle = (
    <Anchor
      component="button"
      type="button"
      fz="inherit"
      className={classes.fold}
      aria-label={expanded ? "Collapse Caption" : "Expand Caption"}
      aria-expanded={expanded}
      onClick={() => setExpanded(!expanded)}
    >
      {expanded ? "Collapse" : "Expand"}
    </Anchor>
  );
  return (
    <div className={classes.caption}>
      <Text
        ref={ref}
        size="sm"
        className={expanded ? classes.captionText : `${classes.captionText} ${classes.folded}`}
        data-long={(long && !expanded) || undefined}
      >
        {text}
        {expanded && <> {toggle}</>}
      </Text>
      {long && !expanded && <span className={classes.unfold}>{toggle}</span>}
    </div>
  );
}

/** The gallery caption in the prompt's style, folding until Expand when long, then all its tags. */
function Caption({ item }: { item: MediaItem }) {
  const caption = item.caption;
  if (!caption?.text && !caption?.tags?.length) return null;
  const tags = [...(caption.tags || [])].sort(compareNames);
  return (
    <DetailSection title="Caption">
      {caption.text && <CaptionText text={caption.text} />}
      {!!tags.length && (
        <Group gap={4} aria-label="Caption Tags">
          {tags.map((tag) => (
            <Badge
              key={tag}
              component={Link}
              {...gallerySearch(item, tag)}
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

const contextCards = [
  { kind: "characters", key: "character", noun: "Character" },
  { kind: "outfits", key: "outfit", noun: "Outfit" },
  { kind: "scenes", key: "scene", noun: "Scene" },
] as const;

const gallerySearch = (item: MediaItem, words: string) => ({
  to: galleryPath(item.type),
  state: { q: words } satisfies GalleryState,
});

/**
 * The cards the chat said a result shows: its character, outfit and scene, each searching the
 * gallery for the results that share it, with Create where Library has no card of that name.
 */
function ContextCards({ item }: { item: MediaItem }) {
  const context = item.resultSet?.context;
  const cards = useGroupFeature("characters") && item.type === "image" && item.status === "done";
  const startCard = useStartCard();
  const lists = {
    characters: useQuery({ ...charactersQuery, enabled: Boolean(cards && context?.character) }),
    outfits: useQuery({
      ...promptCardsQuery("outfits"),
      enabled: Boolean(cards && context?.outfit),
    }),
    scenes: useQuery({ ...promptCardsQuery("scenes"), enabled: Boolean(cards && context?.scene) }),
  };
  if (!context) return null;
  return contextCards.map(({ kind, key, noun }) => {
    const named = context[key];
    if (!named) return null;
    const saved = lists[kind].data;
    const Icon = icons[key];
    return (
      <Stack key={key} gap={2}>
        <PartLabel>{noun}</PartLabel>
        <Anchor component={Link} {...gallerySearch(item, named.name)} size="sm">
          {named.name}
        </Anchor>
        {named.description && <DetailText>{named.description}</DetailText>}
        {cards &&
          saved &&
          !saved.some((card) => card.name.toLowerCase() === named.name.toLowerCase()) && (
            <Button
              variant="subtle"
              size="compact-sm"
              leftSection={<Icon size={14} />}
              style={{ alignSelf: "flex-start" }}
              onClick={() => startCard(kind, item)}
            >
              Create {noun}
            </Button>
          )}
      </Stack>
    );
  });
}

/** One gallery item in full: gallery pages leave out its prompt's thinking, which Details reads here. */
export const galleryItemQuery = (id: string) =>
  queryOptions({
    queryKey: ["gallery-item", id],
    queryFn: () => api<{ item: MediaItem }>(`/api/gallery/items/${encodeURIComponent(id)}`),
    retry: false,
  });

/**
 * Details › Prompt with any Refused Prompt and the prompt's thinking, then any Negative Prompt as its
 * own section.
 */
function DetailsPrompt({ item }: { item: MediaItem }) {
  // A pending tile has no gallery record to read yet.
  const full = useQuery({
    ...galleryItemQuery(item.id),
    enabled: Boolean(item.writing && !item.writing.thinking && item.status !== "pending"),
  });
  return (
    <>
      <DetailSection
        title="Prompt"
        copy={item.prompt || ""}
        after={<WritingThinking writing={full.data?.item.writing ?? item.writing} />}
      >
        <DetailText>{item.prompt || "No prompt recorded."}</DetailText>
        {item.refusedPrompt && (
          <Stack gap={2}>
            <PartLabel>Refused Prompt</PartLabel>
            <DetailText>{item.refusedPrompt}</DetailText>
          </Stack>
        )}
      </DetailSection>
      {item.negative && (
        <DetailSection title="Negative Prompt" copy={item.negative}>
          <DetailText>{item.negative}</DetailText>
        </DetailSection>
      )}
    </>
  );
}

/** Label and value rows A–Z by label, unless `inOrder`, the label column dimmed. */
function Section({
  title,
  rows,
  inOrder = false,
}: {
  title: string;
  rows: [string, React.ReactNode][];
  inOrder?: boolean;
}) {
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
          {(inOrder ? rows : sortRows(rows)).map(([label, value]) => (
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

/**
 * A followed result opens in the gallery's viewer as a step of its own, so closing it returns to
 * the result it was followed from, here or on another page.
 */
const followed = { viewer: true };

/** A link's click that `open` shows in this viewer instead, leaving other clicks to the link. */
const openHere =
  (item: MediaItem, open?: (item: MediaItem) => void) => (event: React.MouseEvent) => {
    if (!open || event.button || event.metaKey || event.ctrlKey || event.shiftKey) return;
    event.preventDefault();
    open(item);
  };

/** Links to the pages of results an item was made from or made. */
function RelatedLinks({ items, open }: { items: MediaItem[]; open?: (item: MediaItem) => void }) {
  return (
    <Stack gap={2} align="flex-start">
      {items.map((related) => (
        <Anchor
          key={related.id}
          component={Link}
          to={viewerPath(related)}
          state={followed}
          size="sm"
          ta="left"
          onClick={openHere(related, open)}
        >
          {mediaTitle(related)}
        </Anchor>
      ))}
    </Stack>
  );
}

/** A frame reference's ID ends with its frame (backend/references.js), and comes from a video. */
const isFrameReference = (id: string) => /:(?:last-frame|frame-\d+)$/.test(id);

/**
 * A reference's thumbnail, linking to the page of the result it was taken from: `source` when it
 * is loaded, otherwise the result its asset names; a reference no longer in the gallery opens its
 * picture in a new tab.
 */
function ReferenceLink({
  reference,
  source,
  open,
}: {
  reference: { id: string; role: string };
  source?: MediaItem;
  open?: (item: MediaItem) => void;
}) {
  const address = `/api/reference-assets/${encodeURIComponent(reference.id)}`;
  const asset = useQuery({ ...referenceAssetQuery(reference.id), enabled: !source }).data;
  const target = source
    ? viewerPath(source)
    : asset?.galleryItemId &&
      viewerPath({
        id: asset.galleryItemId,
        type: isFrameReference(reference.id) ? "video" : "image",
      });
  const thumbnail = (
    <Image src={`${address}/thumbnail`} alt="" w={48} h={48} radius="sm" fallbackSrc="" />
  );
  return target ? (
    <UnstyledButton
      component={Link}
      to={target}
      state={followed}
      aria-label={`Open ${reference.role}`}
      onClick={source && openHere(source, open)}
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
  );
}

/**
 * Details › Caption (with its tags), Model, Prompt, Negative Prompt, Lineage, LoRAs, References,
 * Settings, Output and Timing for one result. Lineage looks among the `loaded` items too, and `open`
 * shows a related result in the viewer.
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
  const jobs = useQuery(queueQuery).data?.jobs;
  const related = useMemo(() => derivations(item, loaded || [], jobs || []), [item, loaded, jobs]);
  const url = item.status === "done" ? mediaSource(item).url : "";
  const size = useMediaSize(url);
  const details = useGenerationDetails(item, url && size.isPending ? null : size.data);
  const context = item.resultSet?.context;
  const comparison = comparisonOf(useQuery(comparisonMembersQuery).data, item);
  // Where it came from, what it is part of and what was made from it, A–Z.
  const lineage = (
    [
      ["From", related.source && <RelatedLinks key="from" items={[related.source]} open={open} />],
      [
        "Source",
        item.source && (
          <Anchor key="source" href={item.source.url} target="_blank" rel="noreferrer" size="sm">
            {item.source.title || item.source.url}
          </Anchor>
        ),
      ],
      // A comparison's result links to its comparison.
      [
        comparison ? "Comparison" : "Set",
        comparison ? (
          <Anchor key="set" component={Link} to={`/compare/${comparison}`} size="sm">
            {item.resultSet?.title || "Open Comparison"}
          </Anchor>
        ) : (
          item.resultSet?.title
        ),
      ],
      [
        "Series",
        context?.series && (
          <Anchor key="series" component={Link} {...gallerySearch(item, context.series)} size="sm">
            {context.series}
          </Anchor>
        ),
      ],
      [
        "Derived",
        related.derived.length > 0 && (
          <RelatedLinks key="derived" items={related.derived} open={open} />
        ),
      ],
    ] as [string, React.ReactNode][]
  ).filter(([, value]) => Boolean(value));
  const faceCheck = Boolean(item.identity || item.faceRedo);
  return (
    <Stack gap="lg" fz="sm">
      <Caption item={item} />
      {details.profile && (
        <DetailSection title="Model">
          <Text size="sm">{details.profile}</Text>
        </DetailSection>
      )}
      <DetailsPrompt item={item} />
      {/* One link needs no label of its own. */}
      {lineage.length === 1 ? (
        <DetailSection title="Lineage">{lineage[0][1]}</DetailSection>
      ) : (
        <Section title="Lineage" rows={lineage} />
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
      {!!(
        details.references.length ||
        details.unused.length ||
        contextCards.some(({ key }) => context?.[key])
      ) && (
        <DetailSection title="References">
          {/* Thumbnails alone, in the run's order; each names its role to assistive technology. */}
          {details.references.length > 0 && (
            <Group gap="xs">
              {details.references.map((reference) => (
                <ReferenceLink
                  key={`${reference.role}:${reference.id}`}
                  reference={reference}
                  source={galleryReference(reference.id, [
                    ...(loaded || []),
                    ...(related.source ? [related.source] : []),
                  ])}
                  open={open}
                />
              ))}
            </Group>
          )}
          {details.unused.map((note) => (
            <Text key={note} size="sm" c="yellow">
              Not used: {note}
            </Text>
          ))}
          <ContextCards item={item} />
        </DetailSection>
      )}
      <Section title="Settings" rows={details.settings} />
      <Section
        title="Output"
        rows={[
          ...details.output,
          ...(faceCheck
            ? [
                [
                  "Face Check",
                  <FaceCheck key="face" identity={item.identity} faceRedo={item.faceRedo} />,
                ] as [string, React.ReactNode],
              ]
            : []),
        ]}
      />
      <Section title="Timing" rows={details.timing} inOrder />
    </Stack>
  );
}
