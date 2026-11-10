import { useState, type DragEvent } from "react";
import { Badge, Image, Menu, Stack, Text, UnstyledButton } from "@mantine/core";
import { ArrowLeft, ArrowRight, Plus, Replace } from "lucide-react";
import { icons } from "../../ui/icons";
import type { Profile, ReferenceAsset } from "../../types";
import {
  galleryReferenceType,
  referenceCells,
  referenceKey,
  referenceLabel,
  type ReferenceTarget,
} from "./references";
import { dragPicture } from "./Picker";
import { StrengthControl } from "./StrengthControl";
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
}: {
  references: ReferenceAsset[];
  profile?: Profile;
  target: ReferenceTarget | null;
  onChoose: (target: ReferenceTarget) => void;
  onChange: (references: ReferenceAsset[]) => void;
  onDrop: (data: DataTransfer, target: ReferenceTarget) => void;
}) {
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
  return (
    <div className={classes.slots} role="group" aria-label="Reference Slots">
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
                    aria-label={`Slot ${number} · ${group.label}${group.required ? " · Required" : ""}`}
                    onClick={() => onChoose(cellTarget)}
                    {...dropProps(`${group.slot}:empty`, cellTarget)}
                  >
                    <Plus size={18} aria-hidden />
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
              return (
                <Menu key={key} withinPortal={false} position="bottom-start">
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
                    <Menu.Item
                      leftSection={<Replace size={16} />}
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
            })}
          </div>
          <Text size="xs" c="dimmed" className={classes.caption}>
            {group.label}
            {group.guides && group.guides !== group.label && ` · ${group.guides}`}
            {group.capacity > 1 && ` · ${group.assets.length}/${group.capacity}`}
            {group.required && (
              <Text span c={group.assets.length ? undefined : "yellow"} inherit>
                {" · Required"}
              </Text>
            )}
          </Text>
        </div>
      ))}
    </div>
  );
}

/**
 * How placed references play their roles: one Strength for each that has one, and a note where one
 * is the start image the result is drawn from (img2img) rather than a guide. A guiding slot's
 * Strength is its own mapped input; the start image's is the profile's denoise.
 */
export function ReferenceRoles({
  references,
  profile,
  start,
  onChange,
}: {
  references: ReferenceAsset[];
  profile?: Profile;
  /** The img2img start slot (shared/characters.ts startImageSlot) and the denoise its Strength sets. */
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
  onChange: (references: ReferenceAsset[]) => void;
}) {
  const startIndex = references.findIndex((asset) => asset.slot === start?.slot);
  const strengths = references.flatMap<{
    asset: ReferenceAsset;
    index: number;
    range: { min: number; max: number; step: number };
    value: number;
    mark?: number;
    set: (value: number) => void;
  }>((asset, index) => {
    const range = profile?.mediaInputs?.find((input) => input.id === asset.slot)?.strength;
    if (range)
      return [
        {
          asset,
          index,
          range,
          value: asset.strength ?? range.default,
          mark: range.default,
          set: (strength: number) =>
            onChange(
              references.map((reference) =>
                reference === asset ? { ...reference, strength } : reference,
              ),
            ),
        },
      ];
    const denoise = index === startIndex ? start?.denoise : undefined;
    return denoise
      ? [
          {
            asset,
            index,
            range: denoise,
            value: denoise.value,
            mark: undefined,
            set: denoise.onChange,
          },
        ]
      : [];
  });
  if (startIndex < 0 && !strengths.length) return null;
  return (
    <Stack gap="xs">
      {startIndex >= 0 && (
        <Text size="xs" c="dimmed">
          Reference {startIndex + 1} is the start image: the result is drawn from it (img2img)
          rather than guided by it.
          {start?.denoise && " Its Strength is the denoise: higher changes more."}
        </Text>
      )}
      {strengths.map(({ asset, index, range, value, mark, set }) => {
        const label = `${referenceLabel(asset, index, profile)} Strength`;
        return (
          <Stack key={referenceKey(asset)} gap={4}>
            <Text size="xs" c="dimmed">
              {label}
            </Text>
            <StrengthControl
              label={label}
              value={value}
              min={range.min}
              max={range.max}
              step={range.step}
              mark={mark}
              onChange={set}
            />
          </Stack>
        );
      })}
    </Stack>
  );
}
