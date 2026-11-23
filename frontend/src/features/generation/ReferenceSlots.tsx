import { Badge, Group, Image, Menu, Stack, Text, UnstyledButton } from "@mantine/core";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { type DragEvent, useState } from "react";

import { menuWidth } from "../../theme";
import type { ReferenceAsset } from "../../types";
import { contextMenuHandlers } from "../../ui/contextMenu";
import { icons } from "../../ui/icons";
import type { SlotLayout } from "./payload";
import { dragPicture } from "./Picker";
import {
  type ReferenceTarget,
  galleryReferenceType,
  referenceCells,
  referenceKey,
  referenceLabel,
} from "./references";
import { StrengthControl } from "./StrengthControl";

import pickerClasses from "./Picker.module.css";
import classes from "./ReferencePicker.module.css";

/** A placed reference dragged onto another slot moves there. */
export const referenceCellType = "application/x-studio-reference-cell";
const accepted = [galleryReferenceType, referenceCellType, "Files"];

/** The profile's reference slots as numbered drop targets, in slot order. */
export function ReferenceSlots({
  references,
  profile,
  target,
  onChoose,
  onChange,
  onDrop,
  onView,
  caption = true,
  emptyLabel,
  onStrengthChange,
  start,
}: {
  references: ReferenceAsset[];
  profile?: SlotLayout;
  target: ReferenceTarget | null;
  onChoose: (target: ReferenceTarget) => void;
  onChange: (references: ReferenceAsset[]) => void;
  onDrop: (data: DataTransfer, target: ReferenceTarget) => void;
  /** Preview, first in a placed reference's menu: shows it full size. */
  onView?: (asset: ReferenceAsset) => void;
  /** Names each group under its slots and counts them; off where the form's label already does. */
  caption?: boolean;
  emptyLabel?: string;
  onStrengthChange?: (references: ReferenceAsset[]) => void;
  /** The img2img start slot and the denoise its Strength sets. */
  start?: {
    slot: string;
    denoise?: {
      value: number;
      min: number;
      max: number;
      step: number;
      onChange: (value: number) => void;
    };
  };
}) {
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const dropProps = (key: string, cellTarget: ReferenceTarget) => ({
    "data-over": over === key || undefined,
    onDragOver: (event: DragEvent) => {
      if (!accepted.some((type) => event.dataTransfer.types.includes(type))) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = event.dataTransfer.types.includes(referenceCellType)
        ? "move"
        : "copy";
      setOver(key);
    },
    onDragLeave: () => setOver((current) => (current === key ? null : current)),
    onDrop: (event: DragEvent) => {
      if (!accepted.some((type) => event.dataTransfer.types.includes(type))) return;
      event.preventDefault();
      setOver(null);
      onDrop(event.dataTransfer, cellTarget);
    },
  });
  function move(peers: ReferenceAsset[], asset: ReferenceAsset, step: number) {
    const neighbour = peers[peers.indexOf(asset) + step];
    if (!neighbour) return;
    const next = [...references];
    const [from, to] = [next.indexOf(asset), next.indexOf(neighbour)];
    [next[from], next[to]] = [next[to], next[from]];
    onChange(next);
  }
  const startImage = start && references.find((asset) => asset.slot === start.slot);
  return (
    <div
      className={`${classes.slots} ${pickerClasses.thumbnailSize}`}
      role="group"
      aria-label="Reference Slots"
    >
      {referenceCells(references, profile).map((group) => (
        <div key={group.slot} className={classes.group}>
          <div className={classes.cells}>
            {group.cells.map(({ asset, number }) => {
              if (!asset) {
                const cellTarget = { slot: group.slot };
                const active = !!target && !target.replace && target.slot === group.slot;
                return (
                  <UnstyledButton
                    key="empty"
                    className={classes.cell}
                    data-empty
                    data-required={(group.required && !group.assets.length) || undefined}
                    data-target={active || undefined}
                    aria-pressed={active}
                    aria-label={
                      emptyLabel ||
                      `Slot ${number} · ${group.label}${group.required ? " · Required" : ""}`
                    }
                    onClick={() => onChoose(cellTarget)}
                    {...dropProps(`${group.slot}:empty`, cellTarget)}
                  >
                    <icons.add size={18} aria-hidden />
                    <Badge className={classes.number} size="xs" circle variant="default">
                      {number}
                    </Badge>
                  </UnstyledButton>
                );
              }
              const key = referenceKey(asset);
              const label = referenceLabel(asset, number - 1, profile);
              const cellTarget = { slot: group.slot, replace: key };
              const peers = group.assets;
              const position = peers.indexOf(asset);
              const range = profile?.mediaInputs?.find(
                (input) => input.id === asset.slot,
              )?.strength;
              const strength =
                range && onStrengthChange
                  ? {
                      ...range,
                      value: asset.strength ?? range.default,
                      mark: range.default,
                      onChange: (strength: number) =>
                        onStrengthChange(
                          references.map((reference) =>
                            reference === asset ? { ...reference, strength } : reference,
                          ),
                        ),
                    }
                  : asset === startImage
                    ? start?.denoise
                    : undefined;
              const tile = (
                <Menu
                  key={key}
                  withinPortal={false}
                  position="bottom-start"
                  width={menuWidth}
                  opened={menuKey === key}
                  onChange={(open) =>
                    setMenuKey((last) => (open ? key : last === key ? null : last))
                  }
                >
                  <Menu.Target>
                    <UnstyledButton
                      className={classes.cell}
                      aria-label={label}
                      data-target={target?.replace === key || undefined}
                      draggable
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "copyMove";
                        event.dataTransfer.setData(referenceCellType, key);
                        const picture = event.currentTarget.querySelector("img");
                        if (picture?.naturalWidth) dragPicture(event.dataTransfer, picture);
                      }}
                      {...dropProps(key, cellTarget)}
                      {...contextMenuHandlers(() => setMenuKey(key))}
                    >
                      <Image
                        src={asset.thumbnailUrl || asset.url}
                        alt=""
                        h="100%"
                        w="100%"
                        fit="cover"
                        fallbackSrc=""
                        draggable={false}
                      />
                      <Badge
                        className={classes.number}
                        size="xs"
                        circle
                        variant="filled"
                        color="dark"
                      >
                        {number}
                      </Badge>
                    </UnstyledButton>
                  </Menu.Target>
                  <Menu.Dropdown aria-label={label}>
                    {onView && (
                      <Menu.Item
                        leftSection={<icons.preview size={16} />}
                        onClick={() => onView(asset)}
                      >
                        Preview
                      </Menu.Item>
                    )}
                    <Menu.Item
                      leftSection={<icons.replace size={16} />}
                      onClick={() => onChoose(cellTarget)}
                    >
                      Replace
                    </Menu.Item>
                    {peers.length > 1 && (
                      <>
                        <Menu.Item
                          leftSection={<ArrowLeft size={16} />}
                          disabled={position === 0}
                          onClick={() => move(peers, asset, -1)}
                        >
                          Move Earlier
                        </Menu.Item>
                        <Menu.Item
                          leftSection={<ArrowRight size={16} />}
                          disabled={position === peers.length - 1}
                          onClick={() => move(peers, asset, 1)}
                        >
                          Move Later
                        </Menu.Item>
                      </>
                    )}
                    <Menu.Divider />
                    <Menu.Item
                      leftSection={<icons.clear size={16} />}
                      onClick={() =>
                        onChange(references.filter((reference) => referenceKey(reference) !== key))
                      }
                    >
                      Remove
                    </Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              );
              if (!strength) return tile;
              return (
                <Group key={key} className={classes.strengthRow} gap="sm" wrap="nowrap">
                  {tile}
                  <Stack gap={0} flex={1} miw={0}>
                    <Text size="xs" c="dimmed">
                      Strength
                    </Text>
                    <StrengthControl
                      label={`${referenceLabel(asset, references.indexOf(asset), profile)} Strength`}
                      {...strength}
                    />
                  </Stack>
                </Group>
              );
            })}
          </div>
          {caption && (
            <Text size="xs" c="dimmed" className={classes.caption}>
              {group.slot === start?.slot || (startImage && group.assets.includes(startImage))
                ? "Start Image"
                : group.label}
              {group.guides && group.guides !== group.label && ` · ${group.guides}`}
              {group.capacity > 1 && ` · ${group.assets.length}/${group.capacity}`}
              {group.required && (
                <Text span c={group.assets.length ? undefined : "yellow"} inherit>
                  {" · Required"}
                </Text>
              )}
            </Text>
          )}
        </div>
      ))}
    </div>
  );
}
