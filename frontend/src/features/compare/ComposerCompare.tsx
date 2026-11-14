import { Button, Group, Menu, SegmentedControl, Text } from "@mantine/core";
import { ChevronDown, CopyPlus, X } from "lucide-react";
import { icons } from "../../ui/icons";
import { chipProps } from "../generation/chip";
import { useGeneration } from "../generation/GenerationProvider";
import {
  addVariant,
  canAddVariant,
  draftVariants,
  letter,
  removeVariant,
  showVariant,
  useDraftComparison,
} from "./variants";

/** The composer's Compare ▾: adds a variant copying the one being edited, or removes it. */
export function CompareMenu() {
  const { draft, setDraft } = useGeneration();
  const active = draft.compare?.active ?? 0;
  return (
    <Menu position="top-start" withinPortal>
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
        <Menu.Item
          leftSection={<CopyPlus size={16} />}
          disabled={!canAddVariant(draft)}
          onClick={() => setDraft(addVariant)}
        >
          Add Variant
        </Menu.Item>
        {draft.compare && (
          <>
            <Menu.Item leftSection={<X size={16} />} onClick={() => setDraft(removeVariant)}>
              Remove Variant {letter(active)}
            </Menu.Item>
            <Menu.Item
              leftSection={<icons.clear size={16} />}
              onClick={() => setDraft((value) => ({ ...value, compare: undefined }))}
            >
              Stop Comparing
            </Menu.Item>
          </>
        )}
      </Menu.Dropdown>
    </Menu>
  );
}

/** Which variant the composer edits, and what sets it apart. */
export function VariantStrip() {
  const { draft, setDraft } = useGeneration();
  const { variants, labels } = useDraftComparison();
  const active = draft.compare?.active ?? 0;
  return (
    <Group gap="xs" wrap="nowrap" miw={0}>
      <SegmentedControl
        aria-label="Variant"
        size="xs"
        radius="xl"
        value={String(active)}
        onChange={(value) =>
          setDraft((previous) => showVariant(previous, draftVariants(previous), Number(value)))
        }
        data={variants.map((_, index) => ({
          value: String(index),
          label: letter(index),
        }))}
      />
      <Text size="sm" c="dimmed" truncate title={labels[active]}>
        {labels[active]}
      </Text>
    </Group>
  );
}
