import {
  Button,
  Checkbox,
  Chip,
  Divider,
  Group,
  Input,
  MultiSelect,
  NumberInput,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, X } from "lucide-react";
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
import { icons } from "../../ui/icons";
import { TextBox } from "../../ui/TextBox";
import { useRemembered } from "../auth/useRemembered";
import { chipProps } from "../generation/chip";
import { useGeneration } from "../generation/GenerationProvider";
import { compatibleLoras, loraInfoQuery } from "../generation/LoraPicker";
import { profileForBackend, profileName } from "../generation/payload";
import { ChipPopup } from "../generation/Picker";
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
  useDraftComparison,
} from "./variants";

const noChoices: string[] = [];
const axes = ["Model", "LoRA", "LoRA Strength", "Resolution", "Seed", "Prompt"];

const modelName = (name: string) =>
  name
    .split(" · ")
    .filter((part) => !/^\d+\s*(?:steps?|refs?|references?)$/i.test(part))
    .join(" · ");

/** Chooses one comparison axis and its values, then stages editable variants in the composer. */
export function CompareMenu() {
  const { draft, setDraft, profiles, profile } = useGeneration();
  const metadata = useQuery(loraInfoQuery);
  const info = metadata.data?.loras ?? {};
  const [opened, setOpened] = useState(false);
  const [remembered, setAxis] = useRemembered("compare-axis", "Model");
  const axis = axes.includes(remembered) ? remembered : "Model";
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
  const compatible = effective?.capabilities.lora ? compatibleLoras(effective, info) : [];
  const loraOptions = compatible
    .map((file) => ({ value: file, label: loraName(file, info[file]) }))
    .sort((a, b) => a.label.localeCompare(b.label));
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
  const stage = () => {
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
  return (
    <ChipPopup
      title="Compare"
      opened={opened}
      onOpenedChange={setOpened}
      width={360}
      target={
        <Button
          {...chipProps}
          onClick={() => setOpened(!opened)}
          leftSection={<icons.compare size={15} />}
          rightSection={<ChevronDown size={14} />}
        >
          Compare
        </Button>
      }
      footer={{
        start: (
          <Button fullWidth disabled={!fitsComparison(count)} onClick={stage}>
            Start Comparing
          </Button>
        ),
      }}
    >
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
          <>
            <MultiSelect
              {...selection}
              label="Models"
              placeholder="Choose models"
              data={modelOptions}
              value={chosen.map((each) => each.id)}
              onChange={setModels}
              maxValues={compareVariants.max - 1}
              nothingFoundMessage="No models found"
            />
            <Text size="xs" c="dimmed">
              Includes the current model, {profile && modelName(profileName(profile))}.
            </Text>
          </>
        )}
        {axis === "LoRA" && (
          <>
            <MultiSelect
              {...selection}
              label="LoRAs"
              placeholder="Choose LoRAs"
              data={loraOptions}
              value={selectedLoras}
              onChange={setLoras}
              maxValues={compareVariants.max - Number(withoutLora)}
              nothingFoundMessage="No compatible LoRAs"
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
          <MultiSelect
            label="Resolutions"
            data={sizeOptions}
            value={selectedSizes}
            onChange={setSizes}
            comboboxProps={{ withinPortal: false }}
            nothingFoundMessage="No native resolutions available"
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
        <Text size="xs" c="dimmed">
          {count} variants · choose {compareVariants.min}–{compareVariants.max} to compare.
        </Text>
        <Divider />
        <Group gap="xs">
          <Button
            variant="subtle"
            size="compact-sm"
            leftSection={<icons.duplicate size={16} />}
            disabled={!canAddVariant(draft)}
            onClick={() => {
              setDraft(addVariant);
              close();
            }}
          >
            {draft.compare ? `Duplicate Variant ${letter(draft.compare.active)}` : "Add Variant"}
          </Button>
          {draft.compare && (
            <>
              <Button
                variant="subtle"
                size="compact-sm"
                leftSection={<X size={16} />}
                onClick={() => {
                  setDraft(removeVariant);
                  close();
                }}
              >
                Remove Variant {letter(draft.compare.active)}
              </Button>
              <Button
                variant="subtle"
                size="compact-sm"
                leftSection={<icons.clear size={16} />}
                onClick={() => {
                  setDraft((value) => ({ ...value, compare: undefined }));
                  close();
                }}
              >
                Stop Comparing
              </Button>
            </>
          )}
        </Group>
      </Stack>
    </ChipPopup>
  );
}

/** Which variant the composer edits; each one's tooltip names what sets it apart. */
export function VariantStrip() {
  const { draft, setDraft } = useGeneration();
  const { variants, labels } = useDraftComparison();
  const active = draft.compare?.active ?? 0;
  return (
    <SegmentedControl
      aria-label="Variant"
      size="xs"
      radius="xl"
      style={{ alignSelf: "flex-start" }}
      value={String(active)}
      onChange={(value) =>
        setDraft((previous) => showVariant(previous, draftVariants(previous), Number(value)))
      }
      data={variants.map((_, index) => ({
        value: String(index),
        label: (
          <Tooltip label={labels[index]} events={{ hover: true, focus: true, touch: true }}>
            <span>{letter(index)}</span>
          </Tooltip>
        ),
      }))}
    />
  );
}
