import { useState } from "react";
import {
  ActionIcon,
  Button,
  Group,
  Menu,
  Modal,
  Popover,
  Stack,
  Switch,
  Textarea,
  Tooltip,
} from "@mantine/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Camera,
  Clapperboard,
  ClipboardCopy,
  Copy,
  Download,
  Ellipsis,
  Flame,
  ListChecks,
  PenLine,
  RefreshCw,
  Repeat,
  Share,
  Shuffle,
  SlidersHorizontal,
  Sparkles,
  Star,
  Zap,
} from "lucide-react";
import { post } from "../../api";
import type { MediaItem } from "../../types";
import { copyText } from "../../ui/clipboard";
import { usePhone } from "../../ui/usePhone";
import { MediaActionItems } from "./MediaActions";
import { useSettingsText } from "./MediaDetails";
import { useMediaTransfer, useShareWithoutSettings } from "./mediaShare";
import { UpscaleControls } from "./UpscaleControls";
import {
  animateThemes,
  assistantQuery,
  useMediaAction,
  type AnimateTheme,
  type Iteration,
} from "./useMediaAction";
import { useMediaFavorite } from "./useMediaFavorite";

const themeIcons: Record<AnimateTheme, typeof Camera> = {
  cinematic: Camera,
  living: Sparkles,
  action: Zap,
  spicy: Flame,
  custom: PenLine,
};

/** The viewer's one icon row: Star, Download/Share, Upscale, Animate, Regenerate, Copy, More, Options. */
export function MediaViewerActions({
  item,
  sessionId,
  compare,
  iterate,
  iterating,
  onApplied,
  onCompare,
  onDelete,
  onVersionChange,
}: {
  item: MediaItem;
  sessionId?: string;
  compare: boolean;
  iterate: (iteration: Iteration) => void;
  iterating?: Iteration["kind"];
  onApplied: () => void;
  onCompare: () => void;
  onDelete: () => void;
  onVersionChange: (id: string, active: boolean) => void;
}) {
  const phone = usePhone();
  // Phones keep 42px touch targets so eight actions still fit one row.
  const size = phone ? 42 : undefined;
  const ready = item.status === "done" && Boolean(item.url);
  const transfer = useMediaTransfer(item, true);
  const favorite = useMediaFavorite(item);
  const action = useMediaAction(item, sessionId, onApplied);
  const assistant = useQuery(assistantQuery);
  const settingsText = useSettingsText(item);
  const [withoutSettings, setWithoutSettings] = useShareWithoutSettings();
  const [instructing, setInstructing] = useState(false);
  const [instruction, setInstruction] = useState("");
  const cache = useQueryClient();
  const version = useMutation({
    mutationFn: (body: { galleryItemId: string; active: boolean }) =>
      post<{ upscaleActive: boolean }>("/api/upscale/toggle", body),
    onSuccess: (result, body) => {
      onVersionChange(body.galleryItemId, result.upscaleActive);
      void cache.invalidateQueries({ queryKey: ["gallery"] });
      void cache.invalidateQueries({ queryKey: ["session"] });
    },
  });
  const tip = (label: string, control: React.ReactElement) => (
    <Tooltip label={label} disabled={phone}>
      {control}
    </Tooltip>
  );
  const themes = (Object.keys(animateThemes) as AnimateTheme[]).filter(
    (theme) => theme !== "spicy" || assistant.data?.spicy,
  );
  return (
    <Group
      gap={phone ? 2 : 6}
      justify={phone ? "space-between" : "center"}
      wrap="nowrap"
      role="group"
      aria-label="Generation Actions"
      onClick={(event) => event.stopPropagation()}
    >
      {ready && (
        <>
          {tip(
            item.favorite ? "Unstar (F)" : "Star (F)",
            <ActionIcon
              variant="default"
              size={size}
              aria-label={item.favorite ? "Unstar" : "Star"}
              aria-pressed={Boolean(item.favorite)}
              c={item.favorite ? "var(--mantine-primary-color-filled)" : undefined}
              disabled={favorite.isPending}
              onClick={() => favorite.mutate()}
            >
              <Star size={18} fill={item.favorite ? "currentColor" : "none"} />
            </ActionIcon>,
          )}
          {transfer.canShare
            ? tip(
                "Share",
                <ActionIcon
                  variant="default"
                  size={size}
                  aria-label={transfer.shareReady ? "Share" : "Prepare Share"}
                  loading={transfer.sharing}
                  onClick={() => void transfer.share()}
                >
                  <Share size={18} />
                </ActionIcon>,
              )
            : tip(
                "Download",
                <ActionIcon
                  component="a"
                  {...transfer.download}
                  variant="default"
                  size={size}
                  aria-label="Download"
                >
                  <Download size={18} />
                </ActionIcon>,
              )}
          <UpscaleControls key={item.id} item={item} size={size} />
          {item.type === "image" && (
            <Menu position="top" width={240}>
              {tip(
                "Animate",
                <Menu.Target>
                  <ActionIcon
                    variant="default"
                    size={size}
                    aria-label="Animate"
                    loading={iterating === "animate" || action.isPending}
                  >
                    <Clapperboard size={18} />
                  </ActionIcon>
                </Menu.Target>,
              )}
              <Menu.Dropdown>
                <Menu.Label>Animate</Menu.Label>
                {assistant.data?.available ? (
                  themes.map((theme) => {
                    const Icon = themeIcons[theme];
                    return (
                      <Menu.Item
                        key={theme}
                        h={36}
                        leftSection={<Icon size={16} />}
                        onClick={() =>
                          theme === "custom"
                            ? setInstructing(true)
                            : iterate({ kind: "animate", theme })
                        }
                      >
                        {animateThemes[theme]}
                        {theme === "custom" ? "…" : ""}
                      </Menu.Item>
                    );
                  })
                ) : (
                  <Menu.Label fw={400}>Motion themes need the prompt assistant.</Menu.Label>
                )}
                <Menu.Divider />
                <Menu.Item
                  h={36}
                  leftSection={<SlidersHorizontal size={16} />}
                  onClick={() => action.mutate("animate")}
                >
                  Animate in Composer
                </Menu.Item>
              </Menu.Dropdown>
            </Menu>
          )}
          <Menu position="top" width={220}>
            {tip(
              "Regenerate",
              <Menu.Target>
                <ActionIcon
                  variant="default"
                  size={size}
                  aria-label="Regenerate"
                  loading={iterating === "regenerate" || iterating === "repeat"}
                >
                  <RefreshCw size={18} />
                </ActionIcon>
              </Menu.Target>,
            )}
            <Menu.Dropdown>
              <Menu.Label>Regenerate</Menu.Label>
              <Menu.Item
                h={36}
                leftSection={<Shuffle size={16} />}
                onClick={() => iterate({ kind: "regenerate" })}
              >
                New Seed
              </Menu.Item>
              <Menu.Item
                h={36}
                leftSection={<Repeat size={16} />}
                onClick={() => iterate({ kind: "repeat" })}
              >
                Exact Repeat
              </Menu.Item>
            </Menu.Dropdown>
          </Menu>
          <Menu position="top" width={220}>
            {tip(
              "Copy",
              <Menu.Target>
                <ActionIcon variant="default" size={size} aria-label="Copy">
                  <Copy size={18} />
                </ActionIcon>
              </Menu.Target>,
            )}
            <Menu.Dropdown>
              <Menu.Item
                h={36}
                leftSection={<Copy size={16} />}
                onClick={() => void copyText(item.prompt || "", "Prompt")}
              >
                Copy Prompt
              </Menu.Item>
              <Menu.Item
                h={36}
                leftSection={<ListChecks size={16} />}
                onClick={() => void copyText(settingsText(), "Settings")}
              >
                Copy Settings
              </Menu.Item>
              {transfer.canCopy && (
                <Menu.Item
                  h={36}
                  leftSection={<ClipboardCopy size={16} />}
                  disabled={transfer.copying}
                  onClick={() => void transfer.copyImage()}
                >
                  Copy Image
                </Menu.Item>
              )}
            </Menu.Dropdown>
          </Menu>
        </>
      )}
      <Menu position="top-end" width={220}>
        {tip(
          "More",
          <Menu.Target>
            <ActionIcon aria-label="More Viewer Actions" variant="default" size={size}>
              <Ellipsis size={18} />
            </ActionIcon>
          </Menu.Target>,
        )}
        <Menu.Dropdown>
          <MediaActionItems
            item={item}
            transfer={transfer}
            sessionId={sessionId}
            // Phones that share natively keep Download here.
            omit={[
              "animate",
              "upscale",
              "share",
              "copy",
              "star",
              ...(transfer.canShare ? [] : (["download"] as const)),
            ]}
            compare={compare}
            onApplied={onApplied}
            onCompare={onCompare}
            onDelete={onDelete}
          />
        </Menu.Dropdown>
      </Menu>
      {ready && (
        <Popover position="top-end" width={280} trapFocus>
          {tip(
            "Viewer Options",
            <Popover.Target>
              <ActionIcon aria-label="Viewer Options" variant="default" size={size}>
                <SlidersHorizontal size={18} />
              </ActionIcon>
            </Popover.Target>,
          )}
          <Popover.Dropdown>
            <Stack gap="md">
              {item.upscale?.url && !item.upscale.withRun && (
                <Switch
                  label="Show Upscale"
                  checked={Boolean(item.upscaleActive)}
                  disabled={version.isPending}
                  onChange={(event) =>
                    version.mutate({ galleryItemId: item.id, active: event.currentTarget.checked })
                  }
                />
              )}
              <Switch
                label="Share Without Settings"
                description="Leave the prompt, seed and workflow out of downloaded or shared files."
                checked={withoutSettings}
                onChange={(event) => setWithoutSettings(event.currentTarget.checked)}
              />
            </Stack>
          </Popover.Dropdown>
        </Popover>
      )}
      <Modal
        opened={instructing}
        onClose={() => setInstructing(false)}
        title="Custom Animation"
        centered
        size="sm"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!instruction.trim()) return;
            iterate({ kind: "animate", theme: "custom", instruction: instruction.trim() });
            setInstructing(false);
          }}
        >
          <Stack>
            <Textarea
              label="Instruction"
              placeholder="What should happen in the video?"
              autosize
              minRows={3}
              data-autofocus
              value={instruction}
              onChange={(event) => setInstruction(event.currentTarget.value)}
            />
            <Group justify="flex-end">
              <Button type="submit" disabled={!instruction.trim()}>
                Animate
              </Button>
            </Group>
          </Stack>
        </form>
      </Modal>
    </Group>
  );
}
