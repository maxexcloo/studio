import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  CloseButton,
  Group,
  Modal,
  MultiSelect,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  SimpleGrid,
  Stack,
  TagsInput,
  Text,
  Tooltip,
} from "@mantine/core";
import { useIsMutating, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useNavigate } from "react-router";
import { post } from "../../api";
import type { GenerationInput, MediaItem, Profile, ReferenceAsset } from "../../types";
import { usePhone } from "../../ui/usePhone";
import { useRemembered } from "../auth/useRemembered";
import { mediaDraft } from "../gallery/useMediaAction";
import { inputForProfile, useGenerationActions } from "../generation/GenerationProvider";
import { blockedProps, submitBlockedReason } from "../generation/GenerationEditor";
import {
  byRating,
  compatibleLoras,
  defaultStrength,
  LoraPicker,
  loraInfoQuery,
  loraTitle,
  useLoraPicker,
  type LoraInfo,
} from "../generation/LoraPicker";
import {
  controlRange,
  generationInput,
  isCloudProfile,
  isProfile,
  stepsRange,
  usesNegative,
} from "../generation/payload";
import { loraLibraryQuery } from "../generation/LoraStacks";
import { profileOptions } from "../generation/ProfilePicker";
import { PromptFields } from "../generation/PromptFields";
import { queueQuery } from "../generation/Queue";
import type { Comparison } from "./queries";
import classes from "./CompareDialog.module.css";

/** The settings a compare run starts from: the composer's draft or a saved result's. */
interface CompareBase {
  input: GenerationInput;
  references: ReferenceAsset[];
  sessionId?: string;
}
type Dimension = "loras" | "profile" | "prompt" | "settings";
const dimensions: { value: Dimension; label: string }[] = [
  { value: "profile", label: "Profiles" },
  { value: "loras", label: "LoRAs" },
  { value: "prompt", label: "Prompts" },
  { value: "settings", label: "Steps & Guidance" },
];
type LoraMode = "toggle" | "loras" | "strengths";
const loraModes: { value: LoraMode; label: string }[] = [
  { value: "toggle", label: "On & Off" },
  { value: "loras", label: "Different LoRAs" },
  { value: "strengths", label: "Strengths" },
];
/** A strength sweep's starting values. */
const sweep = ["0.4", "0.7", "1"];
/** The run's limit, matching `/api/comparisons/run`. */
const most = 4;
const letter = (index: number) => String.fromCharCode(65 + index);
type Lora = GenerationInput["loras"][number];
/** One compared LoRA setting: a LoRA at a strength, or `null` for the run without it. */
type LoraVariant = { name: string; strength: number } | null;

/** A new Steps & Guidance variant: more steps first, then, at the profile's maximum, more guidance. */
function nextSettings(variants: GenerationInput[], profile?: Profile): Partial<GenerationInput> {
  const last = variants.at(-1)!;
  const steps = stepsRange(profile);
  const mostSteps = Math.max(...variants.map((input) => input.steps));
  if (steps && mostSteps < (steps.max ?? 200))
    return { steps: Math.min(steps.max ?? 200, mostSteps * 2), cfg: last.cfg };
  const cfg = controlRange(profile, "cfg", { min: 0, max: 30, step: 0.5 });
  return {
    steps: last.steps,
    cfg: Math.min(cfg?.max ?? 30, Math.max(...variants.map((input) => input.cfg)) + 1),
  };
}

/** The strengths a catalogue range allows, else 0 to 2 as the LoRA picker bounds them. */
const strengthBounds = (info?: LoraInfo) => ({
  min: info?.strengthRange?.min ?? 0,
  max: info?.strengthRange?.max ?? 2,
  step: info?.strengthRange?.step ?? 0.05,
});

/** The last comparison's choices, restored in full while it starts from the same base. */
interface RememberedComparison {
  base?: string;
  dimension?: Dimension;
  shared?: GenerationInput;
  profileIds?: string[];
  patches?: Partial<GenerationInput>[];
  loraMode?: LoraMode;
  lora?: string;
  loraNames?: string[];
  strength?: number | null;
  strengths?: string[];
}
const noComparison: RememberedComparison = {};
/** A restored draft orders its fields differently from the live one, so bases compare sorted. */
const sortedJson = (value: unknown) =>
  JSON.stringify(value, (_, entry: unknown) =>
    entry && typeof entry === "object" && !Array.isArray(entry)
      ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)))
      : entry,
  );

function CompareDialog({ base, onClose }: { base: CompareBase; onClose: () => void }) {
  const { profiles } = useGenerationActions();
  const phone = usePhone();
  const navigate = useNavigate();
  const client = useQueryClient();
  const loraPicker = useLoraPicker();
  const info = useQuery(loraInfoQuery);
  const metadata = info.data?.loras || {};
  const ratings = useQuery(loraLibraryQuery).data?.library.ratings || {};
  const assisting = useIsMutating({ mutationKey: ["prompt-assistance"] }) > 0;
  const profileOf = (input: GenerationInput) =>
    profiles.find((profile) => isProfile(profile, input.profileId));
  const baseProfile = profileOf(base.input);
  // Compare runs on the account's own workers, so cloud profiles stay out.
  const local = profiles.filter((profile) => profile.kind === "image" && !isCloudProfile(profile));
  const usable = (profile: Profile) => profile.ready !== false;
  const options = profileOptions(local);
  const optionLabel = (id: string) =>
    options.flatMap((group) => group.items).find((item) => item.value === id)?.label || id;
  const title = (name: string) => loraTitle(metadata[name], name);
  const baseLoras = baseProfile?.capabilities.lora
    ? compatibleLoras(baseProfile, metadata).sort(byRating(ratings, title))
    : [];
  // A cloud draft compares only against local profiles; its other settings don't run locally.
  const baseLocal = Boolean(baseProfile && local.includes(baseProfile));
  const available = dimensions.filter(
    (option) =>
      (option.value === "profile" || baseLocal) &&
      (option.value !== "loras" || baseLoras.length) &&
      (option.value !== "settings" ||
        stepsRange(baseProfile) ||
        controlRange(baseProfile, "cfg", { min: 0, max: 30 })) &&
      (option.value !== "profile" ||
        local.some((other) => usable(other) && other.id !== baseProfile?.id)),
  );
  // The compared setting and LoRA mode are remembered, and so is the rest while the base matches.
  const [remembered, setRemembered] = useRemembered("compare", noComparison);
  const baseKey = sortedJson(base.input);
  const same = remembered.base === baseKey;
  const [dimension, setDimension] = useState<Dimension>(
    available.find((option) => option.value === remembered.dimension)?.value ||
      available[0]?.value ||
      "profile",
  );
  // Every comparison but Prompts shares one prompt, negative and LoRA stack.
  const [shared, setShared] = useState((same && remembered.shared) || base.input);
  const [profileIds, setProfileIds] = useState(() =>
    same && remembered.profileIds
      ? remembered.profileIds
      : [baseProfile, ...local.filter((profile) => profile.id !== baseProfile?.id)]
          .filter((profile): profile is Profile => Boolean(profile && local.includes(profile)))
          .filter(usable)
          .map((profile) => profile.id)
          .slice(0, 2),
  );
  // Prompts and Steps & Guidance vary these fields over the shared settings.
  const [patches, setPatches] = useState<Partial<GenerationInput>[]>(() =>
    same && remembered.patches && remembered.dimension === dimension
      ? remembered.patches
      : patchesFor(dimension),
  );
  const firstLora =
    base.input.loras.find((lora) => lora.enabled !== false && baseLoras.includes(lora.name))
      ?.name ||
    baseLoras[0] ||
    "";
  const [loraMode, setLoraMode] = useState<LoraMode>(remembered.loraMode || "toggle");
  const [lora, setLora] = useState((same && remembered.lora) || firstLora);
  const [loraNames, setLoraNames] = useState(() =>
    same && remembered.loraNames
      ? remembered.loraNames
      : [firstLora, ...baseLoras.filter((name) => name !== firstLora)].filter(Boolean).slice(0, 2),
  );
  const stacked = (name: string) => base.input.loras.find((entry) => entry.name === name);
  const startStrength = (name: string) =>
    stacked(name)?.strength ?? defaultStrength(metadata[name]?.strengthRange);
  const [strength, setStrength] = useState<number | null>(
    same ? (remembered.strength ?? null) : null,
  );
  const [strengths, setStrengths] = useState(() =>
    same && remembered.strengths ? remembered.strengths : sweep,
  );
  useEffect(
    () =>
      setRemembered({
        base: baseKey,
        dimension,
        shared,
        profileIds,
        patches,
        loraMode,
        lora,
        loraNames,
        strength,
        strengths,
      }),
    [
      baseKey,
      dimension,
      shared,
      profileIds,
      patches,
      loraMode,
      lora,
      loraNames,
      strength,
      strengths,
      setRemembered,
    ],
  );

  function patchesFor(next: Dimension): Partial<GenerationInput>[] {
    if (next === "prompt") {
      const prompt = { prompt: shared.prompt, negative: shared.negative };
      return [prompt, prompt];
    }
    if (next === "settings") {
      const first = { steps: shared.steps, cfg: shared.cfg };
      return [first, nextSettings([shared], profileOf(shared))];
    }
    return [];
  }

  const loraVariants: LoraVariant[] =
    loraMode === "toggle"
      ? [null, { name: lora, strength: strength ?? startStrength(lora) }]
      : loraMode === "loras"
        ? loraNames.map((name) => ({ name, strength: startStrength(name) }))
        : strengths.map((value) => ({ name: lora, strength: Number(value) }));
  const compared = loraMode === "loras" ? loraNames : [lora];
  /** The shared stack with the compared LoRAs swapped for this variant's. */
  const withLora = (variant: LoraVariant): GenerationInput => {
    const rest = shared.loras.filter((entry) => !compared.includes(entry.name));
    if (!variant) return { ...shared, loras: rest };
    const entry: Lora = {
      triggers: true,
      ...stacked(variant.name),
      name: variant.name,
      strength: variant.strength,
      enabled: true,
    };
    return { ...shared, loras: [...rest, entry] };
  };
  /** Another profile starts from its defaults with only the shared LoRAs it can run. */
  const forProfile = (profile: Profile): GenerationInput => {
    if (isProfile(profile, shared.profileId)) return shared;
    const fits = profile.capabilities.lora ? compatibleLoras(profile, metadata) : [];
    const next = { ...inputForProfile(shared, profile), seed: shared.seed };
    return { ...next, loras: next.loras.filter((entry) => fits.includes(entry.name)) };
  };
  const variants: GenerationInput[] =
    dimension === "profile"
      ? profileIds.flatMap((id) => {
          const profile = local.find((profile) => profile.id === id);
          return profile ? [forProfile(profile)] : [];
        })
      : dimension === "loras"
        ? loraVariants.map(withLora)
        : patches.map((patch) => ({ ...shared, ...patch }));
  const labels = variants.map((input, index) => {
    if (dimension === "profile") return optionLabel(input.profileId).slice(0, 80);
    if (dimension === "settings") return `${input.steps} Steps · Guidance ${input.cfg}`;
    if (dimension === "loras") {
      const variant = loraVariants[index];
      return (variant ? `${title(variant.name)} ${variant.strength}` : `${title(lora)} Off`).slice(
        0,
        80,
      );
    }
    return `Prompt ${letter(index)}`;
  });
  const keys = variants.map((input) => JSON.stringify({ ...input, seed: "" }));
  const blockedReason =
    variants.length < 2
      ? dimension === "profile"
        ? "Choose 2–4 profiles to compare."
        : dimension === "loras" && loraMode === "loras"
          ? "Choose 2–4 LoRAs to compare."
          : "Choose 2–4 strengths to compare."
      : dimension === "loras" && !compared.every(Boolean)
        ? "Choose a LoRA to compare."
        : variants
            .map((input) =>
              submitBlockedReason({
                input,
                profile: profileOf(input),
                references: base.references,
                uploading: false,
                assisting,
              }),
            )
            .find(Boolean) ||
          (new Set(keys).size < keys.length
            ? "Change the compared setting so each variant differs."
            : undefined);
  const droppedLoras =
    dimension === "profile" &&
    variants.some((input) => input.loras.length < shared.loras.length) &&
    "LoRAs that don’t suit a profile’s family are left out of its variant.";
  const run = useMutation({
    meta: { inlineError: true },
    mutationFn: () =>
      post<Comparison>("/api/comparisons/run", {
        ...(base.sessionId ? { sessionId: base.sessionId } : {}),
        variants: variants.map((input, index) => {
          const profile = profileOf(input);
          return {
            label: labels[index],
            input: generationInput(
              {
                ...input,
                seed: base.input.seed,
                count: 1,
                negative: usesNegative(profile) ? input.negative : "",
              },
              profile,
              base.references,
            ),
          };
        }),
      }),
    onSuccess: (comparison) => {
      client.setQueryData(["comparison", comparison.id], comparison);
      void client.invalidateQueries({ queryKey: queueQuery.queryKey });
      void client.invalidateQueries({ queryKey: ["gallery"] });
      void client.invalidateQueries({ queryKey: ["sessions"] });
      onClose();
      navigate(`/compare/${comparison.id}`);
    },
  });
  const changeShared = (patch: Partial<GenerationInput>) =>
    setShared((current) => ({ ...current, ...patch }));
  const changePatch = (index: number, patch: Partial<GenerationInput>) =>
    setPatches((current) =>
      current.map((entry, position) => (position === index ? { ...entry, ...patch } : entry)),
    );
  const loraOptions = baseLoras.map((name) => ({ value: name, label: title(name) }));
  const bounds = strengthBounds(metadata[lora]);
  const canAdd = (dimension === "prompt" || dimension === "settings") && patches.length < most;
  const negative =
    dimension === "profile"
      ? variants.some((input) => usesNegative(profileOf(input)))
      : usesNegative(baseProfile);
  return (
    <Modal
      opened
      onClose={onClose}
      title="Compare"
      size={patches.length > 2 && dimension === "prompt" ? 1100 : 760}
      fullScreen={phone}
      closeButtonProps={{ "aria-label": "Close Compare" }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!blockedReason && !run.isPending) run.mutate();
        }}
      >
        <Stack gap="md">
          <SegmentedControl
            aria-label="Compare By"
            fullWidth={phone}
            className={classes.dimensions}
            data={available}
            value={dimension}
            onChange={(value) => {
              const next = value as Dimension;
              setDimension(next);
              setPatches(patchesFor(next));
            }}
          />
          {dimension !== "prompt" && (
            <PromptFields
              input={shared}
              profile={baseProfile}
              references={base.references}
              onChange={changeShared}
              assistantScope="compare"
              negative={negative}
            />
          )}
          {!!baseProfile?.capabilities.lora && (
            <Group gap="xs">
              <LoraPicker value={shared} onChange={setShared} picker={loraPicker} />
              {dimension === "loras" && (
                <Text size="xs" c="dimmed">
                  The other LoRAs in the stack stay the same in every variant.
                </Text>
              )}
            </Group>
          )}
          {dimension === "profile" && (
            <MultiSelect
              label="Profiles"
              description={droppedLoras || "Each variant uses its profile’s defaults."}
              placeholder={profileIds.length < most ? "Add a Profile" : undefined}
              searchable
              maxValues={most}
              nothingFoundMessage="No Matching Profiles"
              data={options.map((group) => ({
                ...group,
                items: group.items.map((item) => ({
                  ...item,
                  disabled: !usable(local.find((profile) => profile.id === item.value)!),
                })),
              }))}
              value={profileIds}
              onChange={setProfileIds}
            />
          )}
          {dimension === "loras" && (
            <Stack gap="sm">
              <SegmentedControl
                aria-label="LoRA Comparison"
                size="xs"
                fullWidth={phone}
                className={classes.dimensions}
                data={loraModes}
                value={loraMode}
                onChange={(value) => setLoraMode(value as LoraMode)}
              />
              {loraMode === "loras" ? (
                <MultiSelect
                  label="LoRAs"
                  description="Each variant runs one of these at its usual strength."
                  searchable
                  maxValues={most}
                  nothingFoundMessage="No Matching LoRAs"
                  data={loraOptions}
                  value={loraNames}
                  onChange={setLoraNames}
                />
              ) : (
                <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">
                  <Select
                    label="LoRA"
                    searchable
                    allowDeselect={false}
                    nothingFoundMessage="No Matching LoRAs"
                    data={loraOptions}
                    value={lora || null}
                    onChange={(value) => {
                      setLora(value || "");
                      setStrength(null);
                    }}
                  />
                  {loraMode === "toggle" ? (
                    <NumberInput
                      label="Strength"
                      {...bounds}
                      decimalScale={2}
                      clampBehavior="blur"
                      value={strength ?? startStrength(lora)}
                      onChange={(value) =>
                        setStrength(value === "" ? null : Number(value) || bounds.min)
                      }
                    />
                  ) : (
                    <TagsInput
                      label="Strengths"
                      description={`Up to ${most}, from ${bounds.min} to ${bounds.max}.`}
                      maxTags={most}
                      splitChars={[",", " "]}
                      acceptValueOnBlur
                      value={strengths}
                      onChange={(values) =>
                        setStrengths(
                          values.filter((value) => {
                            const number = Number(value);
                            return (
                              value.trim() !== "" &&
                              Number.isFinite(number) &&
                              number >= bounds.min &&
                              number <= bounds.max
                            );
                          }),
                        )
                      }
                    />
                  )}
                </SimpleGrid>
              )}
            </Stack>
          )}
          {(dimension === "prompt" || dimension === "settings") && (
            <SimpleGrid
              cols={{ base: 1, sm: Math.min(patches.length, 2), md: patches.length }}
              spacing="sm"
            >
              {variants.map((input, index) => (
                <VariantCard
                  key={index}
                  index={index}
                  label={labels[index]}
                  showLabel={dimension !== "prompt"}
                  onRemove={
                    patches.length > 2
                      ? () =>
                          setPatches((current) =>
                            current.filter((_, position) => position !== index),
                          )
                      : undefined
                  }
                >
                  {dimension === "prompt" ? (
                    <PromptFields
                      input={input}
                      profile={baseProfile}
                      references={base.references}
                      onChange={(patch) => changePatch(index, patch)}
                      assistantScope={`compare:${index}`}
                      negative={negative}
                    />
                  ) : (
                    <SettingsFields
                      input={input}
                      profile={baseProfile}
                      onChange={(patch) => changePatch(index, patch)}
                    />
                  )}
                </VariantCard>
              ))}
            </SimpleGrid>
          )}
          {(dimension === "profile" || dimension === "loras") && variants.length > 0 && (
            <Group gap={6} aria-label="Variants" role="list">
              {labels.map((label, index) => (
                <Badge key={index} role="listitem" tt="none">
                  {letter(index)} · {label}
                </Badge>
              ))}
            </Group>
          )}
          {!!run.error && <Alert color="red">{run.error.message}</Alert>}
          <Group justify="space-between" wrap="nowrap" gap="sm">
            <Text size="sm" c="dimmed">
              {base.input.seed !== ""
                ? `Every variant uses seed ${base.input.seed}.`
                : "Every variant uses the same new seed."}{" "}
              Star the winner to load its settings.
            </Text>
            <Group gap="xs" wrap="nowrap">
              {canAdd && (
                <Tooltip label="Add Variant">
                  <ActionIcon
                    variant="default"
                    aria-label="Add Variant"
                    onClick={() =>
                      setPatches((current) => [
                        ...current,
                        dimension === "settings"
                          ? nextSettings(
                              current.map((patch) => ({ ...shared, ...patch })),
                              baseProfile,
                            )
                          : { ...current.at(-1) },
                      ])
                    }
                  >
                    <Plus size={18} />
                  </ActionIcon>
                </Tooltip>
              )}
              <Tooltip
                label={blockedReason}
                disabled={!blockedReason}
                events={{ hover: true, focus: true, touch: true }}
              >
                <Button type="submit" loading={run.isPending} {...blockedProps(blockedReason)}>
                  Compare {variants.length} Variants
                </Button>
              </Tooltip>
            </Group>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function VariantCard({
  index,
  label,
  showLabel,
  onRemove,
  children,
}: {
  index: number;
  label: string;
  showLabel: boolean;
  onRemove?: () => void;
  children: ReactNode;
}) {
  return (
    <Paper
      withBorder
      p="sm"
      radius="lg"
      role="group"
      aria-label={`Variant ${letter(index)}`}
      className={classes.variant}
    >
      <Stack gap="xs">
        <Group justify="space-between" wrap="nowrap" gap="xs" mih={28}>
          <Text size="sm" fw={600} truncate title={label}>
            Variant {letter(index)}
            {showLabel && (
              <Text span c="dimmed" ml={6}>
                {label}
              </Text>
            )}
          </Text>
          {onRemove && (
            <CloseButton aria-label={`Remove Variant ${letter(index)}`} onClick={onRemove} />
          )}
        </Group>
        {children}
      </Stack>
    </Paper>
  );
}

function SettingsFields({
  input,
  profile,
  onChange,
}: {
  input: GenerationInput;
  profile?: Profile;
  onChange: (patch: Partial<GenerationInput>) => void;
}) {
  const steps = stepsRange(profile);
  const cfg = controlRange(profile, "cfg", { min: 0, max: 30, step: 0.5 });
  return (
    <SimpleGrid cols={2} spacing="xs">
      {steps && (
        <NumberInput
          label="Steps"
          {...steps}
          value={input.steps}
          onChange={(value) => onChange({ steps: Number(value) || steps.min || 1 })}
        />
      )}
      {cfg && (
        <NumberInput
          label="Guidance"
          {...cfg}
          value={input.cfg}
          onChange={(value) => onChange({ cfg: Number(value) || 0 })}
        />
      )}
    </SimpleGrid>
  );
}

const CompareContext = createContext<{
  open(base: CompareBase): void;
  openItem(item: MediaItem): Promise<void>;
} | null>(null);

/** Owns the one Compare dialog that the composer, tiles, viewer and compare page open. */
export function CompareProvider({ children }: { children: ReactNode }) {
  const [base, setBase] = useState<CompareBase | null>(null);
  const { profiles } = useGenerationActions();
  const client = useQueryClient();
  const value = useMemo(
    () => ({
      open: setBase,
      // A saved result keeps its recorded seed, so variants compare against it directly.
      openItem: async (item: MediaItem) => {
        const { draft, seed } = await mediaDraft(item, "image", profiles, client);
        setBase({
          input: { ...draft.input, seed: seed ?? "" },
          references: draft.references,
          sessionId: draft.sessionId || undefined,
        });
      },
    }),
    [profiles, client],
  );
  return (
    <CompareContext.Provider value={value}>
      {children}
      {base && <CompareDialog base={base} onClose={() => setBase(null)} />}
    </CompareContext.Provider>
  );
}

export function useCompare() {
  const context = useContext(CompareContext);
  if (!context) throw new Error("CompareProvider is required");
  return context;
}
