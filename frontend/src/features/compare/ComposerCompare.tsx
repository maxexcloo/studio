import {
  Badge,
  Button,
  Checkbox,
  Chip,
  Group,
  Input,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useState } from "react";

import { compareVariants } from "../../../../shared/compare";
import {
  loraDefaultStrength,
  loraName,
  loraStrengthChoices,
  loraStrengthRange,
  loraStrengthSweep,
} from "../../../../shared/profiles";
import {
  type Resolution,
  availableResolutions,
  withResolution,
} from "../../../../shared/resolution";
import type { GenerationInput } from "../../types";
import { ChipPopup } from "../../ui/ChipPopup";
import { compareNames } from "../../ui/DataTable";
import { icons } from "../../ui/icons";
import { plural } from "../../ui/plural";
import { SelectionList } from "../../ui/SelectionList";
import { TextBox } from "../../ui/TextBox";
import { TitleSelect } from "../../ui/TitleSelect";
import { usePhone } from "../../ui/usePhone";
import { useRemembered } from "../auth/useRemembered";
import { chipProps } from "../generation/chip";
import { useDraft, useGeneration } from "../generation/GenerationProvider";
import { compatibleLoras, loraInfoQuery } from "../generation/LoraPicker";
import { profileForBackend, profileForLoras, profileName } from "../generation/payload";
import { profileOptions } from "../generation/ProfilePicker";
import {
  letter,
  loraInputs,
  promptInputs,
  promptLines,
  seedInputs,
  strengthInputs,
} from "./inputs";
import {
  addVariant,
  canAddVariant,
  compareInputs,
  draftVariants,
  fitsComparison,
  modelInputs,
  removeVariant,
  showVariant,
} from "./variants";

const noChoices: string[] = [];
const axes = ["Current Variant", "Model", "LoRA", "LoRA Strength", "Resolution", "Seed", "Prompt"];

const modelName = (name: string) =>
  name
    .split(" · ")
    .filter((part) => !/^\d+\s*(?:steps?|refs?|references?)$/i.test(part))
    .join(" · ");

/** Chooses one comparison axis and its values, then stages editable variants in the composer. */
export function CompareMenu({ labels }: { labels: string[] }) {
  const { setDraft, profiles, profile } = useGeneration();
  const draft = useDraft();
  const phone = usePhone();
  const metadata = useQuery(loraInfoQuery);
  const info = metadata.data?.loras ?? {};
  const [opened, setOpened] = useState(false);
  const [remembered, setAxis] = useRemembered("compare-axis", "Current Variant");
  const axis = !draft.compare && axes.includes(remembered) ? remembered : "Current Variant";
  const [models, setModels] = useRemembered("compare-models", noChoices);
  const [loras, setLoras] = useRemembered("compare-loras", noChoices);
  const [withoutLora, setWithoutLora] = useRemembered("compare-without-lora", true);
  const [savedStrengths, setStrengths] = useRemembered<number[] | null>("compare-strengths", null);
  const [loraFile, setLoraFile] = useRemembered("compare-strength-lora", "");
  const [sizes, setSizes] = useRemembered("compare-resolutions", noChoices);
  const [seeds, setSeeds] = useRemembered("compare-seeds", "4");
  const [prompts, setPrompts] = useState<string | null>(null);
  const { input } = draft;
  const effective = profileForBackend(profile, input.profileBackend, draft.references.length > 0);
  const available = profiles.filter((each) => each.kind === "image" && each.ready !== false);
  const others = available.filter((each) => each.id !== profile?.id);
  const chosen = others.filter((each) => models.includes(each.id));
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
  const selectedLoras = compatible.filter((file) => loras.includes(file));
  // Only strengths the LoRA accepts; picks made for another range give way to its default sweep.
  const strengthChoices = loraStrengthChoices(info[loraFile]);
  const strengths =
    savedStrengths &&
    savedStrengths.every((value) => value === 0 || strengthChoices.includes(value))
      ? savedStrengths
      : loraStrengthSweep(info[loraFile]);
  const strengthRange = loraStrengthRange(info[loraFile]);
  const native = effective?.options?.resolutions ?? [];
  const sizeOptions = (native.length ? native : availableResolutions(effective, input)).map(
    (value) => ({ value, label: value.toUpperCase() }),
  );
  const selectedSizes = sizes.filter((value) =>
    sizeOptions.some((option) => option.value === value),
  );
  const text = prompts ?? input.prompt;
  const count =
    axis === "Model"
      ? chosen.length + 1
      : axis === "LoRA"
        ? selectedLoras.length + Number(withoutLora)
        : axis === "LoRA Strength"
          ? compatible.includes(loraFile)
            ? strengths.length
            : 0
          : axis === "Resolution"
            ? selectedSizes.length
            : axis === "Seed"
              ? Number(seeds)
              : promptLines(text).length;
  const close = () => setOpened(false);
  const add = () => {
    if (axis === "Current Variant") {
      setDraft(addVariant);
      close();
      return;
    }
    let inputs: GenerationInput[];
    if (axis === "Model") inputs = modelInputs(input, chosen);
    else if (axis === "LoRA")
      inputs = loraInputs(
        input,
        selectedLoras.map((name) => ({
          name,
          strength:
            input.loras.find((lora) => lora.name === name)?.strength ??
            loraDefaultStrength(info[name]),
        })),
        withoutLora,
      );
    else if (axis === "LoRA Strength") inputs = strengthInputs(input, loraFile, strengths);
    else if (axis === "Resolution")
      inputs = selectedSizes.map((size) =>
        native.length
          ? { ...input, resolution: size }
          : withResolution({ ...input, resolutionTier: size as Resolution }, effective),
      );
    else if (axis === "Seed") inputs = seedInputs(input, Number(seeds));
    else inputs = promptInputs({ ...input, prompt: text });
    setDraft((previous) => compareInputs(previous, inputs));
    close();
  };
  const selection = {
    comboboxProps: { withinPortal: false },
    searchable: true,
    maxDropdownHeight: 240,
  };
  const popup = (
    <ChipPopup
      title="Compare"
      detail={
        draft.compare && (
          <Text size="sm" c="dimmed">
            {plural(draft.compare.variants.length, "variant")}
          </Text>
        )
      }
      opened={opened}
      onOpenedChange={setOpened}
      floating={!!draft.compare}
      target={
        <Button
          {...chipProps}
          aria-expanded={opened}
          variant={draft.compare ? "light" : "default"}
          onClick={() => setOpened(!opened)}
          leftSection={<icons.compare size={15} />}
          rightSection={<ChevronDown size={14} />}
        >
          Compare
        </Button>
      }
      onClear={() => {
        setDraft((value) => ({ ...value, compare: undefined }));
        close();
      }}
      clearDisabled={!draft.compare}
      primary={
        <Button
          leftSection={<icons.duplicate size={16} />}
          disabled={axis === "Current Variant" ? !canAddVariant(draft) : !fitsComparison(count)}
          onClick={add}
        >
          Add Variant
        </Button>
      }
    >
      {draft.compare ? (
        opened && <VariantOverview labels={labels} />
      ) : (
        <Stack gap="sm">
          <Select
            label="What to Vary"
            data={axes}
            value={axis}
            allowDeselect={false}
            comboboxProps={{ withinPortal: false }}
            onChange={(value) => setAxis(value!)}
          />
          {axis === "Model" && (
            <SelectionList
              label="Models"
              groups={modelOptions}
              value={chosen.map((each) => each.id)}
              onChange={setModels}
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
                onChange={setLoras}
                max={compareVariants.max - Number(withoutLora)}
                searchable
                empty="No Compatible LoRAs"
              />
              <Checkbox
                label="Include Without Selected LoRAs"
                checked={withoutLora}
                onChange={(event) => setWithoutLora(event.currentTarget.checked)}
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
                onChange={(value) => setLoraFile(value!)}
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
                    onChange={(values) => setStrengths(values.map(Number).sort((a, b) => a - b))}
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
              onChange={setSizes}
              max={compareVariants.max}
              empty="No Resolutions Available"
            />
          )}
          {axis === "Seed" && (
            <NumberInput
              label="Seeds"
              min={compareVariants.min}
              max={compareVariants.max}
              value={Number(seeds)}
              onChange={(value) => setSeeds(String(value))}
            />
          )}
          {axis === "Prompt" && (
            <TextBox
              label="Prompts"
              description="One variant per line."
              autosize
              minRows={3}
              maxRows={6}
              inline
              tools={[]}
              value={text}
              onChange={setPrompts}
            />
          )}
          {axis !== "Current Variant" && (
            <Text size="xs" c="dimmed">
              {axis === "Model" &&
                profile &&
                `Includes the current model, ${modelName(profileName(profile))}. `}
              {plural(count, "variant")} · choose {compareVariants.min}–{compareVariants.max} to
              compare.
            </Text>
          )}
        </Stack>
      )}
    </ChipPopup>
  );
  return phone || !draft.compare ? (
    popup
  ) : (
    <Group gap={6} wrap="nowrap">
      {popup}
      <VariantStrip labels={labels} />
    </Group>
  );
}

function VariantOverview({ labels }: { labels: string[] }) {
  const { setDraft } = useGeneration();
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
                setDraft((draft) => removeVariant(draft, index));
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

/** The variant picker beside Generate in the phone sheet's header. */
export function GenerateVariantSelect() {
  const { setDraft } = useGeneration();
  const draft = useDraft();
  if (!draft.compare) return null;
  return (
    <TitleSelect
      aria-label="Variant"
      withinPortal={false}
      data={draft.compare.variants.map((_, index) => ({
        value: String(index),
        label: `Variant ${letter(index)}`,
      }))}
      value={String(draft.compare.active)}
      onChange={(value) =>
        setDraft((previous) => showVariant(previous, draftVariants(previous), Number(value)))
      }
    />
  );
}

/** Which variant the composer edits; each one's tooltip names what sets it apart. */
function VariantStrip({ labels }: { labels: string[] }) {
  const { setDraft } = useGeneration();
  const draft = useDraft();
  const active = draft.compare?.active ?? 0;
  return (
    <SegmentedControl
      aria-label="Variant"
      size="xs"
      radius="xl"
      value={String(active)}
      onChange={(value) =>
        setDraft((previous) => showVariant(previous, draftVariants(previous), Number(value)))
      }
      data={labels.map((label, index) => ({
        value: String(index),
        label: (
          <Tooltip label={label} events={{ hover: true, focus: true, touch: true }}>
            <span>{letter(index)}</span>
          </Tooltip>
        ),
      }))}
    />
  );
}
