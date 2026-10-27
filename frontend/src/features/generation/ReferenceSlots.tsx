import { useState, type DragEvent } from "react";
import { Badge, Image, Menu, Text, UnstyledButton } from "@mantine/core";
import { ArrowLeft, ArrowRight, ImageDown, Plus, Replace, Trash2 } from "lucide-react";
import type { Profile, ReferenceAsset } from "../../types";
import {
  galleryReferenceType,
  referenceCells,
  referenceKey,
  referenceLabel,
  uploadReferenceType,
  type ReferenceTarget,
} from "./references";
import { dragPicture } from "./Picker";
import classes from "./ReferencePicker.module.css";

/** A placed reference dragged onto another slot moves there. */
export const referenceCellType = "application/x-studio-reference-cell";
const accepted = [galleryReferenceType, uploadReferenceType, referenceCellType, "Files"];

/** The profile's reference slots as numbered drop targets, in slot order. */
export function ReferenceSlots({
  references,
  profile,
  target,
  onChoose,
  onChange,
  onDrop,
  onSave,
}: {
  references: ReferenceAsset[];
  profile?: Profile;
  target: ReferenceTarget | null;
  onChoose: (target: ReferenceTarget) => void;
  onChange: (references: ReferenceAsset[]) => void;
  onDrop: (data: DataTransfer, target: ReferenceTarget) => void;
  onSave: (asset: ReferenceAsset) => void;
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
                    {asset.source === "upload" && (
                      <Menu.Item
                        leftSection={<ImageDown size={16} />}
                        onClick={() => onSave(asset)}
                      >
                        Save to Images
                      </Menu.Item>
                    )}
                    <Menu.Item
                      color="red"
                      leftSection={<Trash2 size={16} />}
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
