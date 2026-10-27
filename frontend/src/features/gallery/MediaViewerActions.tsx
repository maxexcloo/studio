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
  ChevronDown,
  Download,
  Flame,
  PenLine,
  Play,
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
import { usePhone } from "../../ui/usePhone";
import { ActionBarGroups, ActionBarSurface, useActionIconProps, type Action } from "./ActionBar";
import { useMediaActions } from "./MediaActions";
import { useMediaTransfer, useShareWithoutSettings } from "./mediaShare";
import { UpscaleControls } from "./UpscaleControls";
import { assistantQuery } from "../generation/PromptAssistant";
import {
  animateProfileQuery,
  animateThemes,
  useMediaAction,
  type AnimateTheme,
  type Iteration,
} from "./useMediaAction";
import { useMediaFavorite } from "./useMediaFavorite";
import classes from "./MediaViewer.module.css";

const themeIcons: Record<AnimateTheme, typeof Camera> = {
  cinematic: Camera,
  living: Sparkles,
  action: Zap,
  spicy: Flame,
  custom: PenLine,
};

/**
 * The viewer's action bar: the shared item actions in their menu groups, plus Star, Download (Share
 * on phones) and Regenerate, then Viewer Options. Phones move the rest to More Viewer Actions.
 */
export function MediaViewerActions({
  item,
  sessionId,
  compare,
  iterate,
  iterating,
  onApplied,
  onCompare,
  onDelete,
  onRetried,
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
  onRetried: (jobId: string) => void;
  onVersionChange: (id: string, active: boolean) => void;
}) {
  const phone = usePhone();
  const iconProps = useActionIconProps();
  const ready = item.status === "done" && Boolean(item.url);
  const transfer = useMediaTransfer(item, true);
  const favorite = useMediaFavorite(item);
  const action = useMediaAction(item, sessionId, onApplied);
  const assistant = useQuery(assistantQuery);
  // Shown in the Animate menu before anything queues: the model that will run, or why none can.
  const animation = useQuery({
    ...animateProfileQuery(item),
    enabled: ready && item.type === "image",
  });
  const [withoutSettings, setWithoutSettings] = useShareWithoutSettings();
  const [instructing, setInstructing] = useState(false);
  const [instruction, setInstruction] = useState("");
  // A tooltip must not linger behind the menu or popover its control opened.
  const [layer, setLayer] = useState<string | null>(null);
  const layerEvents = (name: string) => ({
    onOpen: () => setLayer(name),
    onClose: () => setLayer((current) => (current === name ? null : current)),
  });
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
    <Tooltip label={label} disabled={phone || Boolean(layer)}>
      {control}
    </Tooltip>
  );
  const themes = (Object.keys(animateThemes) as AnimateTheme[]).filter(
    (theme) => theme !== "spicy" || assistant.data?.spicy,
  );
  const shared = useMediaActions(item, {
    transfer,
    sessionId,
    omit: ["share"],
    compare,
    onApplied,
    onCompare,
    onDelete,
    onRetried,
  });
  const animateControl = (
    <Menu key="animate" position="top" width={240} {...layerEvents("animate")}>
      {tip(
        "Animate",
        <Menu.Target>
          <ActionIcon
            {...iconProps}
            aria-label="Animate"
            loading={iterating === "animate" || action.isPending}
          >
            <Play size={18} />
          </ActionIcon>
        </Menu.Target>,
      )}
      <Menu.Dropdown>
        <Menu.Label>Animate</Menu.Label>
        <Menu.Label fw={400}>
          {animation.error
            ? animation.error.message
            : animation.data
              ? animation.data.note || `Runs on ${animation.data.label}.`
              : "Choosing a video model…"}
        </Menu.Label>
        {assistant.data?.available ? (
          themes.map((theme) => {
            const Icon = themeIcons[theme];
            return (
              <Menu.Item
                key={theme}
                h={36}
                disabled={!animation.data}
                leftSection={<Icon size={16} />}
                onClick={() =>
                  theme === "custom" ? setInstructing(true) : iterate({ kind: "animate", theme })
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
          disabled={!animation.data}
          leftSection={<SlidersHorizontal size={16} />}
          onClick={() => action.mutate("animate")}
        >
          Animate in Composer
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
  const regenerateControl = (
    <ActionIcon.Group key="regenerate">
      {tip(
        "Regenerate",
        <ActionIcon
          {...iconProps}
          aria-label="Regenerate"
          loading={iterating === "regenerate" || iterating === "repeat"}
          onClick={() => iterate({ kind: "regenerate" })}
        >
          <RefreshCw size={18} />
        </ActionIcon>,
      )}
      <Menu position="top" width={220} {...layerEvents("regenerate")}>
        {tip(
          "Regenerate Options",
          <Menu.Target>
            <ActionIcon
              {...iconProps}
              className={`${iconProps.className} ${classes.splitMenu}`}
              aria-label="Regenerate Options"
            >
              <ChevronDown size={14} />
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
    </ActionIcon.Group>
  );
  // Regenerate joins the first group after Recreate; in More it queues a new seed.
  const regenerate: Action = {
    id: "regenerate",
    label: "Regenerate",
    icon: RefreshCw,
    control: regenerateControl,
    onClick: () => iterate({ kind: "regenerate" }),
  };
  const extras: Action[] = !ready
    ? []
    : [
        {
          id: "star",
          label: item.favorite ? "Unstar" : "Star",
          icon: Star,
          pressed: Boolean(item.favorite),
          disabled: favorite.isPending,
          onClick: favorite.mutate,
        },
        ...(transfer.canShare
          ? [
              {
                id: "share",
                label: transfer.shareReady ? "Share" : "Prepare Share",
                icon: Share,
                loading: transfer.sharing,
                onClick: () => void transfer.share(),
              },
            ]
          : []),
        { id: "download", label: "Download", icon: Download, link: transfer.download },
      ];
  const groups = [
    extras,
    ...shared.map((group) =>
      group.flatMap((entry): Action[] => {
        if (entry.id === "animate") return [{ ...entry, control: animateControl }];
        if (entry.id === "upscale")
          return [{ ...entry, control: <UpscaleControls key={item.id} item={item} /> }];
        if (entry.id === "recreate" && ready) return [entry, regenerate];
        return [entry];
      }),
    ),
  ];
  const viewerOptions = (
    <Popover position="top-end" width={280} trapFocus {...layerEvents("options")}>
      {tip(
        "Viewer Options",
        <Popover.Target>
          <ActionIcon aria-label="Viewer Options" {...iconProps}>
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
  );
  return (
    <ActionBarSurface aria-label="Generation Actions" onClick={(event) => event.stopPropagation()}>
      <ActionBarGroups
        groups={groups}
        // Phones that share natively keep Download under More.
        phoneActions={[
          "star",
          transfer.canShare ? "share" : "download",
          "animate",
          "regenerate",
          "upscale",
        ]}
        moreLabel="More Viewer Actions"
        trailing={ready && viewerOptions}
      />
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
    </ActionBarSurface>
  );
}
