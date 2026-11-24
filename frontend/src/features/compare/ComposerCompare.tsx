import {
  Badge,
  Button,
  Checkbox,
  Chip,
  Group,
  Input,
  NumberInput,
  Select,
  Stack,
  Text,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { compareVariants, letter } from "../../../../shared/compare";
import {
  loraDefaultStrength,
  loraName,
  loraStrengthChoices,
  loraStrengthRange,
  loraStrengthSweep,
} from "../../../../shared/profiles";
import { availableResolutions } from "../../../../shared/resolution";
import { ChipPopup } from "../../ui/ChipPopup";
import { compareNames } from "../../ui/DataTable";
import { icons } from "../../ui/icons";
import { plural } from "../../ui/plural";
import { SelectionList } from "../../ui/SelectionList";
import { TextBox } from "../../ui/TextBox";
import { useRemembered } from "../auth/useRemembered";
import { chipProps } from "../generation/chip";
import {
  type CompareAxis,
  type Comparing,
  type Draft,
  useDraft,
  useGeneration,
} from "../generation/GenerationProvider";
import { compatibleLoras, loraInfoQuery } from "../generation/LoraPicker";
import { profileForBackend, profileForLoras, profileName } from "../generation/payload";
import { profileOptions } from "../generation/ProfilePicker";
import { moreSeeds, ownSeed, randomSeed } from "./inputs";
import { removeVariant } from "./variants";

const noChoices: string[] = [];
const axes: CompareAxis[] = ["Model", "LoRA", "LoRA Strength", "Resolution", "Seed", "Prompt"];

const modelName = (name: string) =>
  name
    .split(" · ")
    .filter((part) => !/^\d+\s*(?:steps?|refs?|references?)$/i.test(part))
    .join(" · ");

/**
 * Compare ▾: what to vary and its values, applied as they are chosen. Every variant runs on the
 * composer's settings, changing only what is compared.
 */
export function CompareMenu({ labels }: { labels: string[] }) {
  const { setDraft, profiles, profile } = useGeneration();
  const draft = useDraft();
  const metadata = useQuery(loraInfoQuery);
  const info = metadata.data?.loras ?? {};
  const [opened, setOpened] = useState(false);
  const [models, setModels] = useRemembered("compare-models", noChoices);
  const [loras, setLoras] = useRemembered("compare-loras", noChoices);
  const [withoutLora, setWithoutLora] = useRemembered("compare-without-lora", true);
  const [savedStrengths, setStrengths] = useRemembered<number[] | null>("compare-strengths", null);
  const [savedLora, setLoraFile] = useRemembered("compare-strength-lora", "");
  const [sizes, setSizes] = useRemembered("compare-resolutions", noChoices);
  const [seeds, setSeeds] = useRemembered("compare-seeds", "4");
  const { input, compare } = draft;
  const axis = compare?.axis ?? null;
  const effective = profileForBackend(profile, input.profileBackend, draft.references.length > 0);
  const available = profiles.filter((each) => each.kind === "image" && each.ready !== false);
  const others = available.filter((each) => each.id !== profile?.id);
  const modelIds = compare?.axis === "Model" ? compare.profileIds : models;
  const chosen = others.filter((each) => modelIds.includes(each.id));
  const modelOptions = profileOptions(
    others.map((each) => ({
      ...each,
      displayName: modelName(profileName(each)),
    })),
  );
  const loraProfile = profileForLoras(profile, input.profileBackend, draft.references.length > 0);
  const compatible = loraProfile?.capabilities.lora ? compatibleLoras(loraProfile, info) : [];
  const loraOptions = compatible
    .map((file) => ({ value: file, label: loraName(file, info[file]) }))
    .sort((a, b) => compareNames(a.label, b.label));
  const loraNames = compare?.axis === "LoRA" ? compare.loras.map(({ name }) => name) : loras;
  const selectedLoras = compatible.filter((file) => loraNames.includes(file));
  const without = compare?.axis === "LoRA" ? compare.without : withoutLora;
  const loraFile = compare?.axis === "LoRA Strength" ? compare.lora : savedLora;
  // Only strengths the LoRA accepts; picks made for another range give way to its default sweep.
  const strengthChoices = loraStrengthChoices(info[loraFile]);
  const wanted = compare?.axis === "LoRA Strength" ? compare.strengths : savedStrengths;
  const strengths =
    wanted && wanted.every((value) => value === 0 || strengthChoices.includes(value))
      ? wanted
      : loraStrengthSweep(info[loraFile]);
  const strengthRange = loraStrengthRange(info[loraFile]);
  const native = effective?.options?.resolutions ?? [];
  const sizeOptions = (native.length ? native : availableResolutions(effective, input)).map(
    (value) => ({ value, label: value.toUpperCase() }),
  );
  const selectedSizes = (compare?.axis === "Resolution" ? compare.sizes : sizes).filter((value) =>
    sizeOptions.some((option) => option.value === value),
  );
  const seedCount = compare?.axis === "Seed" ? compare.seeds.length + 1 : Number(seeds);
  // A compared LoRA keeps its strength: as compared, else as in the stack, else its default.
  const loraStrength = (name: string) =>
    (compare?.axis === "LoRA" ? compare.loras : input.loras).find((lora) => lora.name === name)
      ?.strength ?? loraDefaultStrength(info[name]);
  // Each axis as its values now stand.
  const comparing = (next: CompareAxis): Comparing => {
    if (next === "Model") return { axis: next, profileIds: chosen.map((each) => each.id) };
    if (next === "LoRA")
      return {
        axis: next,
        loras: selectedLoras.map((name) => ({ name, strength: loraStrength(name) })),
        without,
      };
    if (next === "LoRA Strength")
      return { axis: next, lora: compatible.includes(loraFile) ? loraFile : "", strengths };
    if (next === "Resolution") return { axis: next, sizes: selectedSizes, native: !!native.length };
    if (next === "Seed")
      return {
        axis: next,
        seeds: moreSeeds(compare?.axis === "Seed" ? compare.seeds : [], seedCount - 1),
      };
    return { axis: next };
  };
  const apply = (next: Comparing | undefined) =>
    setDraft((previous: Draft) => ({
      ...previous,
      // A seed comparison starts from the draft's own seed, choosing one if it has none.
      input:
        next?.axis === "Seed" && !ownSeed(previous.input.seed)
          ? { ...previous.input, seed: randomSeed() }
          : previous.input,
      compare: next,
    }));
  // A changed value applies at once to the comparison running on it.
  const change = (patch: Partial<Comparing>) =>
    compare?.axis && apply({ ...compare, ...patch } as Comparing);
  const selection = {
    comboboxProps: { withinPortal: false },
    searchable: true,
    maxDropdownHeight: 240,
  };
  const set = compare && !compare.axis;
  return (
    <ChipPopup
      title="Compare"
      detail={
        compare && (
          <Text size="sm" c="dimmed">
            {plural(labels.length, "variant")}
          </Text>
        )
      }
      opened={opened}
      onOpenedChange={setOpened}
      target={
        <Button
          {...chipProps}
          aria-expanded={opened}
          variant={compare ? "light" : "default"}
          onClick={() => setOpened(!opened)}
          leftSection={<icons.compare size={15} />}
          rightSection={<ChevronDown size={14} />}
        >
          {compare ? `Compare · ${labels.length}` : "Compare"}
        </Button>
      }
      onClear={() => apply(undefined)}
      clearDisabled={!compare}
    >
      <Stack gap="sm">
        <Select
          label="What to Vary"
          placeholder={set ? "These Variants" : "Choose"}
          data={axes}
          value={axis}
          allowDeselect={false}
          comboboxProps={{ withinPortal: false }}
          onChange={(value) => apply(comparing(value as CompareAxis))}
        />
        {set && opened && <VariantOverview labels={labels} />}
        {axis === "Model" && (
          <SelectionList
            label="Models"
            groups={modelOptions}
            value={chosen.map((each) => each.id)}
            onChange={(value) => {
              setModels(value);
              change({ profileIds: value });
            }}
            max={compareVariants.max - 1}
            searchable
            empty="No Other Models Available"
          />
        )}
        {axis === "LoRA" && (
          <>
            <SelectionList
              label="LoRAs"
              groups={[{ items: loraOptions }]}
              value={selectedLoras}
              onChange={(value) => {
                setLoras(value);
                change({ loras: value.map((name) => ({ name, strength: loraStrength(name) })) });
              }}
              max={compareVariants.max - Number(without)}
              searchable
              empty="No Compatible LoRAs"
            />
            <Checkbox
              label="Include Without Selected LoRAs"
              checked={without}
              onChange={(event) => {
                setWithoutLora(event.currentTarget.checked);
                change({ without: event.currentTarget.checked });
              }}
            />
          </>
        )}
        {axis === "LoRA Strength" && (
          <>
            <Select
              {...selection}
              label="LoRA"
              placeholder="Choose a LoRA"
              data={loraOptions}
              value={compatible.includes(loraFile) ? loraFile : null}
              onChange={(value) => {
                setLoraFile(value!);
                change({ lora: value!, strengths: loraStrengthSweep(info[value!]) });
              }}
              allowDeselect={false}
              nothingFoundMessage="No compatible LoRAs"
            />
            {compatible.includes(loraFile) && (
              <Input.Wrapper
                label="Strengths"
                description={`Supports ${strengthRange.min} to ${strengthRange.max}.`}
              >
                <Chip.Group
                  multiple
                  value={strengths.map(String)}
                  onChange={(values) => {
                    const next = values.map(Number).sort((a, b) => a - b);
                    setStrengths(next);
                    change({ strengths: next });
                  }}
                >
                  <Group gap={6} mt={6} role="group" aria-label="Strengths">
                    {[0, ...strengthChoices].map((strength) => (
                      <Chip key={strength} value={String(strength)} size="xs" variant="light">
                        {strength ? strength : "Without LoRA"}
                      </Chip>
                    ))}
                  </Group>
                </Chip.Group>
              </Input.Wrapper>
            )}
          </>
        )}
        {axis === "Resolution" && (
          <SelectionList
            label="Resolutions"
            groups={[{ items: sizeOptions }]}
            value={selectedSizes}
            onChange={(value) => {
              setSizes(value);
              change({ sizes: value });
            }}
            max={compareVariants.max}
            empty="No Resolutions Available"
          />
        )}
        {axis === "Seed" && (
          <NumberInput
            label="Seeds"
            min={compareVariants.min}
            max={compareVariants.max}
            allowDecimal={false}
            value={seedCount}
            onChange={(value) => {
              const count = Number(value);
              if (count < compareVariants.min || count > compareVariants.max) return;
              setSeeds(String(count));
              if (compare?.axis === "Seed") change({ seeds: moreSeeds(compare.seeds, count - 1) });
            }}
          />
        )}
        {axis === "Prompt" && <PromptLines />}
        {axis && (
          <Text size="xs" c="dimmed">
            {axis === "Model" &&
              profile &&
              `Includes the current model, ${modelName(profileName(profile))}. `}
            {plural(labels.length, "variant")} · choose {compareVariants.min}–{compareVariants.max}.
            Everything else follows the composer.
          </Text>
        )}
      </Stack>
    </ChipPopup>
  );
}

/** The composer's own prompt, one variant per line; it follows typing, as the prompt box does. */
function PromptLines() {
  const { update } = useGeneration();
  const { prompt } = useDraft(true).input;
  return (
    <TextBox
      label="Prompts"
      description="One variant per line of the prompt."
      autosize
      minRows={3}
      maxRows={6}
      inline
      tools={[]}
      value={prompt}
      onChange={(value) => update({ prompt: value })}
    />
  );
}

/** Set variants, such as Compare Again's, each named by what sets it apart. */
function VariantOverview({ labels }: { labels: string[] }) {
  const { setDraft, profiles } = useGeneration();
  return (
    <Stack component="ol" aria-label="Variants" gap="xs" m={0} p={0}>
      {labels.map((label, index) => (
        <Group component="li" key={index} gap="xs" align="baseline" wrap="nowrap">
          <Badge variant="default" size="sm">
            {letter(index)}
          </Badge>
          <Text size="sm" flex={1}>
            {label}
          </Text>
          {/* Fewer than the minimum ends the comparison, so Clear does that. */}
          {labels.length > compareVariants.min && (
            <Button
              size="compact-sm"
              variant="subtle"
              aria-label={`Remove Variant ${letter(index)}`}
              onClick={(event) => {
                // Rows are keyed by position, so only the last row's button goes; focus stays in the popup.
                if (index === labels.length - 1)
                  event.currentTarget
                    .closest("li")
                    ?.previousElementSibling?.querySelector("button")
                    ?.focus();
                setDraft((draft) => removeVariant(draft, profiles, index));
              }}
            >
              Remove
            </Button>
          )}
        </Group>
      ))}
    </Stack>
  );
}
