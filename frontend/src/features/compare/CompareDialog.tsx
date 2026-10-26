import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import {
  ActionIcon,
  Alert,
  Button,
  CloseButton,
  Group,
  Modal,
  NumberInput,
  Paper,
  SegmentedControl,
  SimpleGrid,
  Stack,
  Text,
  Textarea,
  Tooltip,
} from "@mantine/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useNavigate } from "react-router";
import { post } from "../../api";
import type { GenerationInput, MediaItem, Profile, ReferenceAsset } from "../../types";
import { usePhone } from "../../ui/usePhone";
import { mediaDraft } from "../gallery/useMediaAction";
import { inputForProfile, useGenerationActions } from "../generation/GenerationProvider";
import { blockedProps } from "../generation/GenerationEditor";
import { controlRange, generationInput, isProfile, stepsRange } from "../generation/payload";
import { ProfilePicker } from "../generation/ProfilePicker";
import { queueQuery } from "../generation/Queue";
import type { Comparison } from "./queries";

/** The settings a compare run starts from: the composer's draft or a saved result's. */
export interface CompareBase {
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
const letter = (index: number) => String.fromCharCode(65 + index);
const loraName = (name: string) =>
  name
    .split(/[\\/]/)
    .pop()!
    .replace(/\.safetensors$/i, "");

/** A new variant changes the compared setting, so it never repeats an existing one. */
function nextVariant(
  variants: GenerationInput[],
  dimension: Dimension,
  profiles: Profile[],
): GenerationInput {
  const last = variants.at(-1)!;
  if (dimension === "profile") {
    const unused = profiles.find(
      (profile) =>
        profile.kind === "image" &&
        profile.ready !== false &&
        !variants.some((input) => input.profileId === profile.id),
    );
    return unused ? { ...inputForProfile(last, unused), seed: last.seed } : { ...last };
  }
  if (dimension === "loras")
    return {
      ...last,
      loras: last.loras.map((lora) =>
        lora.enabled
          ? { ...lora, enabled: false }
          : { ...lora, enabled: true, strength: Math.min(2, Math.max(lora.strength, 0.5) + 0.25) },
      ),
    };
  if (dimension === "settings") {
    // More steps first; once the profile's maximum is reached, more guidance.
    const profile = profiles.find((profile) => isProfile(profile, last.profileId));
    const steps = stepsRange(profile);
    const most = Math.max(...variants.map((input) => input.steps));
    if (steps && most < (steps.max ?? 200))
      return { ...last, steps: Math.min(steps.max ?? 200, most * 2) };
    const cfg = controlRange(profile, "cfg", { min: 0, max: 30, step: 0.5 });
    return {
      ...last,
      cfg: Math.min(cfg?.max ?? 30, Math.max(...variants.map((input) => input.cfg)) + 1),
    };
  }
  return { ...last };
}
const initialVariants = (base: GenerationInput, dimension: Dimension, profiles: Profile[]) => [
  base,
  nextVariant([base], dimension, profiles),
];

function variantLabel(
  input: GenerationInput,
  dimension: Dimension,
  index: number,
  profiles: Profile[],
) {
  if (dimension === "profile") {
    const profile = profiles.find((profile) => isProfile(profile, input.profileId));
    return (profile?.displayName || profile?.label || `Variant ${letter(index)}`).slice(0, 80);
  }
  if (dimension === "settings") return `${input.steps} Steps · Guidance ${input.cfg}`;
  if (dimension === "loras")
    return (
      input.loras
        .map((lora) => `${loraName(lora.name)} ${lora.enabled ? lora.strength : "Off"}`)
        .join(" · ")
        .slice(0, 80) || `Variant ${letter(index)}`
    );
  return `Prompt ${letter(index)}`;
}

function VariantFields({
  input,
  dimension,
  profile,
  onChange,
}: {
  input: GenerationInput;
  dimension: Dimension;
  profile?: Profile;
  onChange: (next: GenerationInput) => void;
}) {
  if (dimension === "profile")
    return (
      <Group>
        <ProfilePicker value={input} onChange={(next) => onChange({ ...next, seed: input.seed })} />
      </Group>
    );
  if (dimension === "prompt")
    return (
      <Textarea
        aria-label="Prompt"
        autosize
        minRows={3}
        maxRows={8}
        value={input.prompt}
        onChange={(event) => onChange({ ...input, prompt: event.currentTarget.value })}
      />
    );
  if (dimension === "settings") {
    const steps = stepsRange(profile);
    const cfg = controlRange(profile, "cfg", { min: 0, max: 30, step: 0.5 });
    return (
      <SimpleGrid cols={2} spacing="xs">
        {steps && (
          <NumberInput
            label="Steps"
            {...steps}
            value={input.steps}
            onChange={(value) => onChange({ ...input, steps: Number(value) || steps.min || 1 })}
          />
        )}
        {cfg && (
          <NumberInput
            label="Guidance"
            {...cfg}
            value={input.cfg}
            onChange={(value) => onChange({ ...input, cfg: Number(value) || 0 })}
          />
        )}
      </SimpleGrid>
    );
  }
  return (
    <Stack gap="xs">
      {input.loras.map((lora, index) => (
        <NumberInput
          key={lora.name}
          label={loraName(lora.name)}
          description={lora.enabled ? undefined : "Off"}
          min={0}
          max={2}
          step={0.05}
          decimalScale={2}
          value={lora.enabled ? lora.strength : 0}
          onChange={(value) => {
            const strength = Number(value) || 0;
            onChange({
              ...input,
              loras: input.loras.map((entry, position) =>
                position === index
                  ? { ...entry, enabled: strength > 0, strength: strength || entry.strength }
                  : entry,
              ),
            });
          }}
        />
      ))}
    </Stack>
  );
}

function CompareDialog({ base, onClose }: { base: CompareBase; onClose: () => void }) {
  const { profiles } = useGenerationActions();
  const phone = usePhone();
  const navigate = useNavigate();
  const client = useQueryClient();
  const profile = profiles.find((profile) => isProfile(profile, base.input.profileId));
  const available = dimensions.filter(
    (option) =>
      (option.value !== "loras" || (profile?.capabilities.lora && base.input.loras.length)) &&
      (option.value !== "settings" ||
        stepsRange(profile) ||
        controlRange(profile, "cfg", { min: 0, max: 30 })) &&
      (option.value !== "profile" ||
        profiles.some((other) => other.kind === "image" && other.id !== profile?.id)),
  );
  const [dimension, setDimension] = useState<Dimension>(available[0]?.value || "prompt");
  const [variants, setVariants] = useState(() => initialVariants(base.input, dimension, profiles));
  const labels = variants.map((input, index) => variantLabel(input, dimension, index, profiles));
  const keys = variants.map((input) => JSON.stringify({ ...input, seed: "" }));
  const blockedReason = variants.some((input) => !input.prompt.trim())
    ? "Every variant needs a prompt."
    : new Set(keys).size < keys.length
      ? "Change the compared setting so each variant differs."
      : undefined;
  const canAdd =
    variants.length < 4 &&
    (dimension !== "profile" ||
      profiles.some(
        (other) =>
          other.kind === "image" &&
          other.ready !== false &&
          !variants.some((input) => input.profileId === other.id),
      ));
  const run = useMutation({
    meta: { inlineError: true },
    mutationFn: () =>
      post<Comparison>("/api/comparisons/run", {
        ...(base.sessionId ? { sessionId: base.sessionId } : {}),
        variants: variants.map((input, index) => ({
          label: labels[index],
          input: generationInput(
            { ...input, seed: base.input.seed, count: 1 },
            profiles.find((profile) => isProfile(profile, input.profileId)),
            base.references,
          ),
        })),
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
  const change = (index: number, next: GenerationInput) =>
    setVariants((current) => current.map((input, position) => (position === index ? next : input)));
  return (
    <Modal
      opened
      onClose={onClose}
      title="Compare Variants"
      size={variants.length > 2 ? 1100 : 760}
      fullScreen={phone}
      closeButtonProps={{ "aria-label": "Close Compare Variants" }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!blockedReason && !run.isPending) run.mutate();
        }}
      >
        <Stack gap="md">
          <Text size="sm" c="dimmed">
            {base.input.seed !== ""
              ? `Every variant uses seed ${base.input.seed}.`
              : "Every variant uses the same new seed."}{" "}
            Star the winner to load its settings and teach your taste profile.
          </Text>
          <SegmentedControl
            aria-label="Compare"
            radius="xl"
            fullWidth={phone}
            style={phone ? undefined : { alignSelf: "flex-start" }}
            data={available}
            value={dimension}
            onChange={(value) => {
              setDimension(value as Dimension);
              setVariants(initialVariants(base.input, value as Dimension, profiles));
            }}
          />
          <SimpleGrid
            cols={{ base: 1, sm: Math.min(variants.length, 2), md: variants.length }}
            spacing="sm"
          >
            {variants.map((input, index) => (
              <Paper
                key={index}
                withBorder
                p="sm"
                radius="lg"
                role="group"
                aria-label={`Variant ${letter(index)}`}
              >
                <Stack gap="xs">
                  <Group justify="space-between" wrap="nowrap" gap="xs">
                    <Text size="sm" fw={600} truncate title={labels[index]}>
                      Variant {letter(index)}
                    </Text>
                    {variants.length > 2 && (
                      <CloseButton
                        size="sm"
                        aria-label={`Remove Variant ${letter(index)}`}
                        onClick={() =>
                          setVariants((current) =>
                            current.filter((_, position) => position !== index),
                          )
                        }
                      />
                    )}
                  </Group>
                  <VariantFields
                    input={input}
                    dimension={dimension}
                    profile={profiles.find((profile) => isProfile(profile, input.profileId))}
                    onChange={(next) => change(index, next)}
                  />
                </Stack>
              </Paper>
            ))}
          </SimpleGrid>
          {!!run.error && <Alert color="red">{run.error.message}</Alert>}
          <Group justify="space-between">
            <Tooltip label="Add Variant" disabled={!canAdd}>
              <ActionIcon
                variant="default"
                radius="xl"
                size="lg"
                aria-label="Add Variant"
                disabled={!canAdd}
                onClick={() =>
                  setVariants((current) => [...current, nextVariant(current, dimension, profiles)])
                }
              >
                <Plus size={18} />
              </ActionIcon>
            </Tooltip>
            <Tooltip
              label={blockedReason}
              disabled={!blockedReason}
              events={{ hover: true, focus: true, touch: true }}
            >
              <Button
                type="submit"
                radius="xl"
                loading={run.isPending}
                {...blockedProps(blockedReason)}
              >
                Compare {variants.length} Variants
              </Button>
            </Tooltip>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

const CompareContext = createContext<{
  open(base: CompareBase): void;
  openItem(item: MediaItem): Promise<void>;
} | null>(null);

/** Owns the one Compare Variants dialog that the composer, tiles and viewer open. */
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
