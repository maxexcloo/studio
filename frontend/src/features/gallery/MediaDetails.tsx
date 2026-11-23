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
import { useQuery } from "@tanstack/react-query";
import { Check } from "lucide-react";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";

import { guidingRoles } from "../../../../shared/profiles";
import { titleCase } from "../../../../shared/titles";
import type { MediaItem, Profile } from "../../types";
import { formatBytes } from "../../ui/bytes";
import { useCopy } from "../../ui/clipboard";
import { compareNames } from "../../ui/DataTable";
import { formatDateTime } from "../../ui/dates";
import { icons } from "../../ui/icons";
import { useAccount, useGroupFeature } from "../auth/AccountGate";
import { identityNote } from "../characters/identity";
import { charactersQuery, promptCardsQuery } from "../characters/queries";
import { useStartCard } from "../characters/useCardFrom";
import { comparisonMembersQuery, comparisonOf } from "../compare/queries";
import { useGenerationActions } from "../generation/GenerationProvider";
import { loraInfoQuery } from "../generation/LoraPicker";
import { backendLabel, isProfile, profileForBackend } from "../generation/payload";
import { WritingThinking } from "../generation/PromptWriting";
import { queueQuery } from "../generation/Queue";
import { referenceAssetQuery } from "../generation/references";
import { mediaProfileName, mediaTitle } from "./mediaLabels";
import { mediaSource } from "./mediaSource";
import { galleryItemQuery } from "./queries";
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
type Row = [label: string, value: string];
const sortRows = <T extends [string, unknown]>(rows: T[]) =>
  [...rows].sort(([a], [b]) => compareNames(a, b));
/** A reference the run took: the role it ran as and, where recorded, how strongly it applied. */
interface RanReference {
  id: string;
  name?: string;
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

const enabledLoras = (settings: MediaItem["settings"]) =>
  Array.isArray(settings?.loras)
    ? settings.loras.filter((lora) => lora?.name && lora.enabled !== false)
    : undefined;

function actualSeed(value: unknown) {
  const seed = typeof value === "number" || typeof value === "string" ? String(value).trim() : "";
  return /^\d+$/.test(seed) ? seed.replace(/^0+(?=\d)/, "") : "";
}

function lineageChanges(
  parent: MediaItem,
  item: MediaItem,
  profiles: Profile[],
  loraTitle: (file: string) => string,
) {
  if (parent.status !== "done" || item.status !== "done") return [];
  const changes: string[] = [];
  const before = parent.settings;
  const after = item.settings;
  const recordedChange = (a: unknown, b: unknown) =>
    typeof a === "string" && a !== "" && typeof b === "string" && b !== "" && a !== b;
  const modelChanged =
    recordedChange(parent.model, item.model) || recordedChange(before?.modelName, after?.modelName);
  if (modelChanged || recordedChange(before?.profileId, after?.profileId)) {
    const label = modelChanged ? "Model" : "Profile";
    const from = mediaProfileName(parent, profiles);
    const to = mediaProfileName(item, profiles);
    changes.push(from && to && from !== to ? `${label}: ${from} → ${to}` : `${label} changed`);
  }
  if (recordedChange(before?.profileBackend, after?.profileBackend)) {
    const from = backendLabel(String(before?.profileBackend));
    const to = backendLabel(String(after?.profileBackend));
    changes.push(`Backend: ${from} → ${to}`);
  }
  const oldSeed = actualSeed(before?.seed);
  const newSeed = actualSeed(after?.seed);
  if (oldSeed && newSeed && oldSeed !== newSeed) changes.push(`Seed: ${oldSeed} → ${newSeed}`);
  const oldLoras = enabledLoras(before);
  const newLoras = enabledLoras(after);
  if (oldLoras && newLoras) {
    const strengths = (loras: typeof oldLoras) =>
      new Map(loras.map(({ name, strength }) => [String(name), Number(strength)]));
    const previous = strengths(oldLoras);
    const current = strengths(newLoras);
    for (const name of new Set([...previous.keys(), ...current.keys()])) {
      const oldStrength = previous.get(name);
      const newStrength = current.get(name);
      if (oldStrength === undefined) changes.push(`Added ${loraTitle(name)}`);
      else if (newStrength === undefined) changes.push(`Removed ${loraTitle(name)}`);
      else if (
        Number.isFinite(oldStrength) &&
        Number.isFinite(newStrength) &&
        oldStrength !== newStrength
      )
        changes.push(`${loraTitle(name)}: ${oldStrength} → ${newStrength}`);
    }
  }
  if (
    typeof parent.prompt === "string" &&
    typeof item.prompt === "string" &&
    parent.prompt.trim() !== item.prompt.trim()
  )
    changes.push("Prompt changed");
  const references = (settings: MediaItem["settings"]) =>
    Array.isArray(settings?.referenceAssets)
      ? JSON.stringify(
          settings.referenceAssets
            .filter((reference) => reference?.assetId)
            .map(({ slot, assetId, strength }) => [slot, assetId, strength]),
        )
      : undefined;
  const oldReferences = references(before);
  const newReferences = references(after);
  if (oldReferences !== undefined && newReferences !== undefined && oldReferences !== newReferences)
    changes.push("References changed");
  return changes;
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
  const shown = mediaSource(item);
  const inpaint = settings.inpaint as { strength?: number } | undefined;
  const video = item.type === "video";
  // Radiance runs its own text encoder, VAE and sampler, so ComfyUI's recorded choices don't apply.
  const comfyui = (value: unknown) => (settings.profileBackend === "radiance" ? "" : value);
  const staged = (Array.isArray(settings.referenceAssets) ? settings.referenceAssets : []).filter(
    (
      reference,
    ): reference is { slot?: string; assetId: string; name?: string; strength?: number } =>
      Boolean(reference?.assetId),
  );
  const recorded = profileForBackend(
    profiles.find((profile) => isProfile(profile, settings.profileId)),
    typeof settings.profileBackend === "string" ? settings.profileBackend : undefined,
    Boolean(staged.length),
  );
  const guides = !inpaint && settings.referenceRole === "reference";
  const slots = recorded?.mediaInputs || [];
  // The reference a run frames and edits: the start slot's, else the first.
  const primarySlot = (slots.find((slot) => slot.role === "start") || slots[0])?.id;
  const primary = staged.find((reference) => reference.slot === primarySlot) || staged[0];
  const denoise = Number(settings.denoise);
  const references = staged.map((reference, index): RanReference => {
    const { slot, assetId: id, name, strength } = reference;
    const input = slots.find((input) => input.id === slot);
    const guiding =
      input?.role && Object.hasOwn(guidingRoles, input.role) && guidingRoles[input.role];
    const applied = input?.strength && Number.isFinite(strength) ? `Strength ${strength}` : "";
    if (video) {
      const role = input?.label || titleCase(slot || "") || `Reference ${index + 1}`;
      return { id, name, role, strength: applied };
    }
    if (guiding || reference !== primary || guides)
      return { id, name, role: guiding || `Reference ${index + 1}`, strength: applied };
    if (inpaint)
      return {
        id,
        name,
        role: "Edit Source · Masked",
        strength: inpaint.strength === undefined ? "" : `Inpaint ${inpaint.strength}`,
      };
    return { id, name, role: "Edit Source", strength: denoise > 0 ? `Denoise ${denoise}` : "" };
  });
  return {
    profile: mediaProfileName(item, profiles),
    loras: (enabledLoras(settings) || []).map((lora) => ({
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
      ["Seed", settings.seed === 0 ? "0" : settings.seed],
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
      ["Added to Gallery", item.galleryAt !== item.createdAt && time(item.galleryAt)],
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

function useGenerationDetails(item: MediaItem, size?: number | null, source?: MediaItem) {
  const { profiles } = useGenerationActions();
  const info = useQuery(loraInfoQuery);
  const loraTitle = (file: string) => info.data?.loras[file]?.title || fileStem(file);
  return {
    ...generationDetails(item, { profiles, size, loraTitle }),
    changes: source ? lineageChanges(source, item, profiles, loraTitle) : [],
  };
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

function CopyDetail({ title, text }: { title: string; text: string }) {
  const copier = useCopy();
  return (
    <Tooltip label={copier.copied ? "Copied" : `Copy ${title}`}>
      <ActionIcon
        size="sm"
        my={-6}
        variant="subtle"
        color="gray"
        aria-label={`Copy ${title}`}
        disabled={!text}
        onClick={() => copier.copy(text)}
      >
        {copier.copied ? <Check size={14} /> : <icons.copy size={14} />}
      </ActionIcon>
    </Tooltip>
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
  return (
    <Stack gap={6}>
      <Group justify="space-between" wrap="nowrap">
        <Title order={6}>{title}</Title>
        {copy !== undefined && <CopyDetail title={title} text={copy} />}
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

/** The gallery caption, its searchable tags and any notes saved with the run. */
function Caption({ item }: { item: MediaItem }) {
  const caption = item.caption;
  const notes = Array.from(
    new Set([item.resultSet?.context?.notes?.trim(), item.resultSet?.caption?.trim()]),
  ).filter((note): note is string => Boolean(note));
  if (!caption?.text && !caption?.tags?.length && !notes.length) return null;
  const tags = [...(caption?.tags || [])].sort(compareNames);
  return (
    <DetailSection title="Caption">
      {caption?.text && <CaptionText text={caption.text} />}
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
      {notes.length > 0 && (
        <Stack gap={2}>
          <Group justify="space-between" wrap="nowrap">
            <PartLabel>Notes</PartLabel>
            <CopyDetail title="Notes" text={notes.join("\n\n")} />
          </Group>
          {notes.map((note) => (
            <DetailText key={note}>{note}</DetailText>
          ))}
        </Stack>
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
    <Stack gap={4} align="flex-start">
      {items.map((related) => {
        const source = mediaSource(related);
        const thumbnail = source.thumbnailUrl || (related.type === "image" ? source.url : "");
        return (
          <Anchor
            key={related.id}
            component={Link}
            to={viewerPath(related)}
            state={followed}
            size="sm"
            ta="left"
            maw="100%"
            onClick={openHere(related, open)}
          >
            <Group component="span" gap="xs" wrap="nowrap">
              <Image
                src={thumbnail || undefined}
                alt=""
                w={48}
                h={48}
                flex="0 0 auto"
                radius="sm"
                loading="lazy"
                fallbackSrc=""
              />
              <span>{mediaTitle(related)}</span>
            </Group>
          </Anchor>
        );
      })}
    </Stack>
  );
}

/** A frame reference's ID ends with its frame (backend/references.js), and comes from a video. */
const isFrameReference = (id: string) => /:(?:last-frame|frame-\d+)$/.test(id);

/**
 * A reference's thumbnail, named by its role for assistive technology, linking to the page of the result it was taken from: `source` when it
 * is loaded, otherwise the result its asset names; a reference no longer in the gallery opens its
 * picture in a new tab.
 */
function ReferenceLink({
  reference,
  source,
  open,
}: {
  reference: RanReference;
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
  const presentation = (
    <Image src={`${address}/thumbnail`} alt="" w={48} h={48} radius="sm" fallbackSrc="" />
  );
  return (
    <Tooltip label={reference.role}>
      {target ? (
        <UnstyledButton
          component={Link}
          to={target}
          state={followed}
          aria-label={`Open ${reference.role}`}
          onClick={source && openHere(source, open)}
        >
          {presentation}
        </UnstyledButton>
      ) : (
        <UnstyledButton
          component="a"
          href={`${address}/media`}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${reference.role}`}
        >
          {presentation}
        </UnstyledButton>
      )}
    </Tooltip>
  );
}

/**
 * Details › Caption, Lineage, Model, LoRAs, Prompt, Negative Prompt, References,
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
  const local = useMemo(() => derivations(item, loaded || [], jobs || []), [item, loaded, jobs]);
  const parent = useQuery({
    ...galleryItemQuery(local.sourceId || ""),
    enabled: Boolean(local.sourceId && !local.source),
  });
  const fetched = parent.data?.item;
  const related = useMemo(
    () =>
      fetched && !local.source
        ? derivations(item, [...(loaded || []), fetched], jobs || [])
        : local,
    [fetched, item, jobs, loaded, local],
  );
  const source = related.source;
  const url = item.status === "done" ? mediaSource(item).url : "";
  const size = useMediaSize(url);
  const details = useGenerationDetails(item, url && size.isPending ? null : size.data, source);
  const set = item.resultSet;
  const context = set?.context;
  const chatUrl = useAccount().data?.chatUrl;
  const { conversationId: conversation, turnId: turn } = item.chat || {};
  // LibreChat conversations have UUIDs; MCP session and placeholder IDs are not routable chats.
  const chatAddress =
    chatUrl && conversation && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(conversation)
      ? new URL(chatUrl)
      : null;
  if (chatAddress) {
    chatAddress.pathname = `${chatAddress.pathname.replace(/\/+$/, "")}/c/${conversation}`;
    chatAddress.search = "";
    chatAddress.hash = "";
  }
  const comparison = comparisonOf(useQuery(comparisonMembersQuery).data, item);
  // The nearest source first, then its ancestry and offshoots.
  const lineage = (
    [
      [
        "Made From",
        source ? (
          <Stack gap={4} key="from">
            <RelatedLinks items={[source]} open={open} />
            {details.changes.length > 0 && (
              <Stack gap={2}>
                <PartLabel>Changes From Source</PartLabel>
                <Text component="ul" size="xs" c="dimmed" m={0} ps="md">
                  {details.changes.map((change) => (
                    <li key={change}>{change}</li>
                  ))}
                </Text>
              </Stack>
            )}
          </Stack>
        ) : (
          related.sourceId && (
            <Text size="sm" c="dimmed">
              {parent.isPending ? "Loading…" : "Source Result Unavailable"}
            </Text>
          )
        ),
      ],
      ["Original", related.original && <RelatedLinks items={[related.original]} open={open} />],
      [
        "Versions",
        related.versions.length > 0 && <RelatedLinks items={related.versions} open={open} />,
      ],
      [
        "Derived",
        related.derived.length > 0 && <RelatedLinks items={related.derived} open={open} />,
      ],
      [
        "Chat",
        conversation && (
          <Stack gap={2} align="flex-start">
            <Anchor
              component={Link}
              to={galleryPath(item.type)}
              state={{ chat: conversation, turn, show: "chat" } satisfies GalleryState}
              size="sm"
            >
              Results From This Chat
            </Anchor>
            {turn && (
              <Anchor
                component={Link}
                to={galleryPath(item.type)}
                state={{ chat: conversation, turn } satisfies GalleryState}
                size="sm"
              >
                Results From This Turn
              </Anchor>
            )}
            {chatAddress && (
              <Anchor href={chatAddress.href} target="_blank" rel="noreferrer" size="sm">
                Continue in Chat
              </Anchor>
            )}
          </Stack>
        ),
      ],
      [
        "Imported From",
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
            {set?.title || "Open Comparison"}
          </Anchor>
        ) : (
          set?.id &&
          set.title && (
            <Anchor
              key="set"
              component={Link}
              to={galleryPath(item.type)}
              state={{ set: set.id } satisfies GalleryState}
              size="sm"
            >
              {set.title}
            </Anchor>
          )
        ),
      ],
      [
        "Theme",
        context?.series && (
          <Anchor key="series" component={Link} {...gallerySearch(item, context.series)} size="sm">
            {context.series}
          </Anchor>
        ),
      ],
    ] as [string, React.ReactNode][]
  ).filter(([, value]) => Boolean(value));
  const faceCheck = Boolean(item.identity || item.faceRedo);
  return (
    <Stack gap="lg" fz="sm">
      <Caption item={item} />
      {lineage.length > 0 && (
        <DetailSection title="Lineage">
          <Stack gap="sm">
            {lineage.map(([label, content]) => (
              <Stack key={label} gap={4}>
                {lineage.length > 1 && <PartLabel>{label}</PartLabel>}
                {content}
              </Stack>
            ))}
          </Stack>
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
      <DetailsPrompt item={item} />
      {!!(
        details.references.length ||
        details.unused.length ||
        contextCards.some(({ key }) => context?.[key])
      ) && (
        <DetailSection title="References">
          {details.references.length > 0 && (
            <Group gap="xs">
              {details.references.map((reference) => (
                <ReferenceLink
                  key={`${reference.role}:${reference.id}`}
                  reference={reference}
                  source={galleryReference(reference.id, [
                    ...(loaded || []),
                    ...(source ? [source] : []),
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
      {/* The heading above Details (ViewerMetadata) already names the model and its steps. */}
      <Section title="Settings" rows={details.settings.filter(([label]) => label !== "Steps")} />
      <Section
        title="Output"
        rows={[
          // The dimensions and time already show under the title.
          ...details.output.filter(([label]) => label !== "Dimensions" && label !== "Time"),
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
