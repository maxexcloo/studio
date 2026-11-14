import { Button, Menu, SegmentedControl, Tooltip } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, X } from "lucide-react";
import { useState } from "react";

import { isCloudProfile } from "../../../../shared/profiles";
import { menuWidth } from "../../theme";
import type { GenerationInput, Profile } from "../../types";
import { type Action, type ActionGroups, ActionMenuItems } from "../../ui/ActionBar";
import { icons } from "../../ui/icons";
import { modelFamilyLabel } from "../../ui/modelFamily";
import { useRemembered } from "../auth/useRemembered";
import { chipProps } from "../generation/chip";
import { useGeneration } from "../generation/GenerationProvider";
import { loraInfoQuery, loraTitle } from "../generation/LoraPicker";
import { profileName } from "../generation/payload";
import {
  addVariant,
  canAddVariant,
  compareInputs,
  draftVariants,
  fitsComparison,
  letter,
  modelInputs,
  promptInputs,
  promptLines,
  removeVariant,
  seedInputs,
  showVariant,
  strengthInputs,
  useDraftComparison,
} from "./variants";

const noModels: string[] = [];
const strengthOptions = [0, 0.4, 0.6, 0.8, 1, 1.2];
const defaultStrengths = [0, 0.6, 0.8, 1];
const seedCounts = ["2", "3", "4", "6"];

const toggled = <T,>(list: T[], value: T) =>
  list.includes(value) ? list.filter((each) => each !== value) : [...list, value];

/**
 * The composer's Compare ▾: duplicates or removes the variant being edited, or builds a whole
 * comparison from it across models, a LoRA's strengths, seeds or the prompt's lines.
 */
export function CompareMenu() {
  const { draft, setDraft, profiles, profile } = useGeneration();
  const loraInfo = useQuery(loraInfoQuery).data?.loras;
  const [models, setModels] = useRemembered("compare-models", noModels);
  const [strengths, setStrengths] = useRemembered("compare-strengths", defaultStrengths);
  const [seeds, setSeeds] = useRemembered("compare-seeds", "4");
  const [loraName, setLoraName] = useState<string>();
  const { input } = draft;
  const active = draft.compare?.active ?? 0;
  const compare = (inputs: GenerationInput[]) =>
    setDraft((previous) => compareInputs(previous, inputs));
  const run = (id: string, label: string, inputs: () => GenerationInput[], count: number) => ({
    id,
    label,
    icon: icons.compare,
    disabled: !fitsComparison(count),
    onClick: () => compare(inputs()),
  });

  const others = profiles.filter(
    (each) => each.kind === "image" && each.ready !== false && each.id !== profile?.id,
  );
  const chosen = others.filter((each) => models.includes(each.id));
  const facts = (each: Profile) =>
    `${modelFamilyLabel(each.family, each.familyName)} · ${isCloudProfile(each) ? "Cloud" : "Local GPU"}`;
  const loras = input.loras.filter((lora) => lora.enabled !== false);
  const lora = loras.find((each) => each.name === loraName) ?? loras[0];
  const lines = promptLines(input.prompt).length;
  const variantActions: Action[] = [
    {
      id: "add-variant",
      label: draft.compare ? `Duplicate Variant ${letter(active)}` : "Add Variant",
      icon: icons.duplicate,
      disabled: !canAddVariant(draft),
      onClick: () => setDraft(addVariant),
    },
  ];
  if (draft.compare)
    variantActions.push(
      {
        id: "remove-variant",
        label: `Remove Variant ${letter(active)}`,
        icon: X,
        onClick: () => setDraft(removeVariant),
      },
      {
        id: "stop-comparing",
        label: "Stop Comparing",
        icon: icons.clear,
        onClick: () => setDraft((value) => ({ ...value, compare: undefined })),
      },
    );
  const builders: Action[] = [
    {
      id: "compare-models",
      label: "Compare Models",
      icon: icons.compareSideBySide,
      disabled: !others.length,
      menu: [
        others.map((each) => ({
          id: `model-${each.id}`,
          label: profileName(each),
          description: facts(each),
          checked: models.includes(each.id),
          keepOpen: true,
          onClick: () => setModels(toggled(models, each.id)),
        })),
        [
          run(
            "run-models",
            `Compare ${chosen.length + 1} Models`,
            () => modelInputs(input, chosen),
            chosen.length + 1,
          ),
        ],
      ],
    },
  ];
  if (lora)
    builders.push({
      id: "compare-strengths",
      label: "Compare LoRA Strengths",
      icon: icons.loras,
      menu: [
        loras.length > 1
          ? [
              {
                id: "strength-lora",
                label: "LoRA",
                choice: {
                  value: lora.name,
                  options: loras.map((each) => ({
                    value: each.name,
                    label: loraTitle(loraInfo?.[each.name], each.name),
                  })),
                  onChange: setLoraName,
                },
              },
            ]
          : [],
        strengthOptions.map((strength) => ({
          id: `strength-${strength}`,
          label: strength ? `Strength ${strength}` : "Without LoRA",
          checked: strengths.includes(strength),
          keepOpen: true,
          onClick: () => setStrengths(toggled(strengths, strength).sort((a, b) => a - b)),
        })),
        [
          run(
            "run-strengths",
            `Compare ${strengths.length} Strengths`,
            () => strengthInputs(input, lora.name, strengths),
            strengths.length,
          ),
        ],
      ],
    });
  builders.push(
    {
      id: "compare-seeds",
      label: "Compare Seeds",
      icon: icons.variations,
      menu: [
        [
          {
            id: "seed-count",
            label: "Seeds",
            choice: {
              value: seeds,
              options: seedCounts.map((count) => ({ value: count, label: count })),
              onChange: setSeeds,
            },
          },
        ],
        [
          run(
            "run-seeds",
            `Compare ${seeds} Seeds`,
            () => seedInputs(input, Number(seeds)),
            Number(seeds),
          ),
        ],
      ],
    },
    {
      ...run("compare-prompts", "Compare Prompts", () => promptInputs(input), lines),
      icon: icons.prompt,
      description: "One variant per line of the prompt",
    },
  );
  const groups: ActionGroups = [variantActions, builders];
  return (
    <Menu position="top-start" width={menuWidth} withinPortal>
      <Menu.Target>
        <Button
          {...chipProps}
          leftSection={<icons.compare size={15} />}
          rightSection={<ChevronDown size={14} />}
        >
          Compare
        </Button>
      </Menu.Target>
      <Menu.Dropdown>
        <ActionMenuItems groups={groups} />
      </Menu.Dropdown>
    </Menu>
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
