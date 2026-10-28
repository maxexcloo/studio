import { useEffect, useRef, useState } from "react";
import { ActionIcon, Button, Group, Loader, Menu, Stack, Text, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { queryOptions, useMutation, useQuery } from "@tanstack/react-query";
import { Check, Sparkles, Square } from "lucide-react";
import { api, failure, request } from "../../api";
import type { GenerationInput, Profile, ReferenceAsset } from "../../types";
import classes from "./PromptAssistant.module.css";

interface AssistantStatus {
  available: boolean;
  presets: { id: string; label: string; description?: string }[];
  defaultPreset?: string;
  vision?: boolean;
  loras?: boolean;
  noNegative?: string[];
  /** The account holds Uncensored Models. */
  spicy?: boolean;
}
interface Suggestion {
  name: string;
  title: string;
  strength: number;
  triggers: string[];
  reason: string;
}
interface Result {
  prompt?: string;
  negative?: string | null;
  loras?: Suggestion[];
  unused?: boolean;
  source?: string;
  reason?: string;
  model?: string;
}
type Action = "rewrite" | "negative" | "loras";
const workingLabels: Record<Action, string> = {
  rewrite: "Improving the prompt…",
  negative: "Writing a negative prompt…",
  loras: "Finding LoRAs…",
};

/** What the prompt assistant offers this account. */
export const assistantQuery = queryOptions({
  queryKey: ["assistant"],
  queryFn: () => api<AssistantStatus>("/api/assistant"),
  retry: false,
});

async function referenceImage(asset: ReferenceAsset, signal: AbortSignal) {
  const response = await request(`/api/reference-assets/${encodeURIComponent(asset.id)}/media`, {
    signal,
  });
  const bitmap = await createImageBitmap(await response.blob());
  try {
    const scale = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    bitmap.close();
  }
}

/** The prompt box's assistance action and any LoRA suggestions it produced. */
export function usePromptAssistant({
  input,
  profile,
  onChange,
  references = [],
  scopeKey = "",
}: {
  input: GenerationInput;
  profile?: Profile;
  onChange: (patch: Partial<GenerationInput>) => void;
  references?: ReferenceAsset[];
  scopeKey?: string;
}) {
  const status = useQuery(assistantQuery);
  // The style last used comes first and is marked, so repeating it is one click.
  const [presetId, setPresetId] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const scope = useRef(0);
  const undoNotifications = useRef(new Set<string>());
  const latest = useRef({ input, profile, onChange });
  latest.current = { input, profile, onChange };
  useEffect(() => {
    mounted.current = true;
    scope.current++;
    setSuggestions([]);
    return () => {
      mounted.current = false;
      scope.current++;
      controller.current?.abort();
      undoNotifications.current.forEach((id) => notifications.hide(id));
      undoNotifications.current.clear();
    };
  }, [profile?.id, scopeKey]);
  const info = status.data;
  const preset =
    info?.presets.find((item) => item.id === presetId) ||
    info?.presets.find((item) => item.id === info.defaultPreset) ||
    info?.presets[0];
  const negativeOffered =
    profile?.capabilities.negativePrompt !== false &&
    !info?.noNegative?.includes(profile?.id || "");
  const lorasOffered = Boolean(
    info?.loras && profile?.capabilities.lora && profile.options?.loras?.length,
  );
  function applyChange(message: string, patch: Partial<GenerationInput>) {
    const before = latest.current.input;
    const epoch = scope.current;
    latest.current.onChange(patch);
    const notification = notifications.show({
      autoClose: 10000,
      message: (
        <Group justify="space-between" wrap="nowrap">
          <Text size="sm">{message}</Text>
          <Button
            data-composer-layer
            size="compact-sm"
            variant="subtle"
            onClick={() => {
              notifications.hide(notification);
              undoNotifications.current.delete(notification);
              if (!mounted.current || scope.current !== epoch) return;
              const current = latest.current.input;
              const restore: Partial<GenerationInput> = {};
              for (const [key, value] of Object.entries(patch)) {
                if (key === "loras") {
                  const added = patch.loras!.filter(
                    (lora) => !before.loras.some((prior) => prior.name === lora.name),
                  );
                  const remaining = current.loras.filter(
                    (lora) =>
                      !added.some(
                        (applied) =>
                          applied.name === lora.name &&
                          applied.strength === lora.strength &&
                          applied.enabled === lora.enabled,
                      ),
                  );
                  if (remaining.length !== current.loras.length) restore.loras = remaining;
                } else if (JSON.stringify(current[key]) === JSON.stringify(value))
                  restore[key] = before[key];
              }
              if (Object.keys(restore).length) latest.current.onChange(restore);
            }}
          >
            Undo
          </Button>
        </Group>
      ),
    });
    undoNotifications.current.add(notification);
  }
  const assistance = useMutation({
    mutationKey: ["prompt-assistance"],
    mutationFn: async ({ action, preset }: { action: Action; preset?: string }) => {
      if (!profile || !input.prompt.trim())
        throw new Error("Write a prompt and choose a profile first.");
      const source = {
        profileId: profile.id,
        prompt: input.prompt,
        negative: input.negative,
        scope: scope.current,
      };
      const abort = new AbortController();
      controller.current = abort;
      const body: Record<string, unknown> = { profileId: profile.id, prompt: input.prompt };
      if (action !== "loras")
        body.loras = input.loras.filter((item) => item.enabled !== false).map((item) => item.name);
      if (action === "rewrite") {
        body.preset = preset;
        body.stream = false;
        body.references = info?.vision
          ? await Promise.all(
              references.slice(0, 4).map((asset) => referenceImage(asset, abort.signal)),
            )
          : [];
      } else if (action === "negative") body.cfg = input.cfg;
      const result = await api<Result>(`/api/assistant/${action}`, {
        method: "POST",
        signal: abort.signal,
        body: JSON.stringify(body),
      });
      abort.signal.throwIfAborted();
      if (action !== "loras" && result.source === "fallback")
        throw new Error(`The prompt assistant is unavailable (${result.reason || "no reply"}).`);
      return { action, result, source, preset };
    },
    onSuccess: ({ action, result, source, preset }) => {
      if (!mounted.current || source.scope !== scope.current) return;
      const current = latest.current;
      if (
        current.profile?.id !== source.profileId ||
        current.input.prompt !== source.prompt ||
        (action === "negative" && current.input.negative !== source.negative)
      ) {
        notifications.show({
          message:
            "Your inputs changed while assistance was running. Request assistance again to use the updated inputs.",
        });
        return;
      }
      if (action === "rewrite") {
        if (!result.prompt?.trim()) {
          failure("The assistant returned an empty prompt.");
          return;
        }
        applyChange("Prompt improved", {
          prompt: result.prompt,
          assistant: { preset, model: result.model, source: "ui" },
        });
      } else if (action === "negative") {
        if (result.unused || !result.negative?.trim()) {
          notifications.show({ message: "This model does not use a negative prompt." });
          return;
        }
        applyChange("Negative prompt written", { negative: result.negative });
      } else {
        const offered = new Set(current.profile?.options?.loras || []);
        const usable = (result.loras || []).filter((item) => offered.has(item.name));
        setSuggestions(usable);
        if (!usable.length) notifications.show({ message: "No LoRAs fit this prompt." });
      }
    },
    onSettled: () => {
      controller.current = null;
    },
  });
  function apply(suggestion: Suggestion) {
    if (input.loras.some((item) => item.name === suggestion.name)) return;
    if (input.loras.filter((item) => item.enabled !== false).length >= (profile?.maxLoras || 8)) {
      notifications.show({
        color: "yellow",
        message: "Disable or remove a LoRA before adding another.",
      });
      return;
    }
    // Studio adds enabled LoRAs' trigger words when it runs the prompt.
    applyChange("LoRA applied", {
      loras: [
        ...input.loras,
        { name: suggestion.name, strength: suggestion.strength, enabled: true },
      ],
    });
  }
  if (!info?.available || !profile || !info.presets.length)
    return { action: null, suggestions: null };
  const disabled = !input.prompt.trim();
  const run = (action: Action, style?: string) => {
    if (style) setPresetId(style);
    assistance.mutate({ action, preset: style });
  };
  const working = assistance.variables && workingLabels[assistance.variables.action];
  // While it works the action spins; hovering or focusing it offers Stop.
  const action = assistance.isPending ? (
    <Tooltip label={`${working} Click to Stop.`}>
      <ActionIcon
        className={classes.working}
        variant="subtle"
        color="gray"
        aria-label="Stop Assistance"
        aria-description={working}
        onClick={() => {
          controller.current?.abort();
          notifications.show({ message: "Assistance stopped" });
        }}
      >
        <span className={classes.icons}>
          <Loader className={classes.spinner} size={16} />
          <Square className={classes.stop} size={14} />
        </span>
      </ActionIcon>
    </Tooltip>
  ) : (
    <Menu position="top-end" width={240}>
      <Tooltip label="Prompt Assistance">
        <Menu.Target>
          <ActionIcon variant="subtle" color="gray" aria-label="Prompt Assistance">
            <Sparkles size={16} />
          </ActionIcon>
        </Menu.Target>
      </Tooltip>
      <Menu.Dropdown data-composer-layer>
        {info.presets.length > 1 ? (
          <>
            <Menu.Label>Improve Prompt</Menu.Label>
            {/* Each style is a choice that runs at once; the last one used carries a check. */}
            {[...info.presets]
              .sort((a, b) => a.label.localeCompare(b.label))
              .map((item) => (
                <Menu.Item
                  key={item.id}
                  disabled={disabled}
                  aria-label={`Improve Prompt: ${item.label}`}
                  rightSection={item.id === preset?.id ? <Check size={14} /> : undefined}
                  onClick={() => run("rewrite", item.id)}
                >
                  {item.label}
                </Menu.Item>
              ))}
            {(negativeOffered || lorasOffered) && <Menu.Divider />}
          </>
        ) : (
          <Menu.Item disabled={disabled} onClick={() => run("rewrite", preset?.id)}>
            Improve Prompt
          </Menu.Item>
        )}
        {lorasOffered && (
          <Menu.Item disabled={disabled} onClick={() => run("loras")}>
            Suggest LoRAs
          </Menu.Item>
        )}
        {negativeOffered && (
          <Menu.Item disabled={disabled} onClick={() => run("negative")}>
            Write Negative
          </Menu.Item>
        )}
        {!!references.length && info.vision && (
          <Text size="xs" c="dimmed" px="sm" py={6}>
            Selected references are shared with the assistant when improving the prompt.
          </Text>
        )}
      </Menu.Dropdown>
    </Menu>
  );
  const list = suggestions.length ? (
    <Stack gap="xs">
      {suggestions.map((item) => {
        const added = input.loras.some((lora) => lora.name === item.name);
        return (
          <Group key={item.name} justify="space-between" wrap="nowrap" align="start">
            <Stack gap={2} style={{ minWidth: 0 }}>
              <Text size="sm">{item.title || item.name}</Text>
              <Text size="xs" c="dimmed">
                {item.reason}
              </Text>
              {!!item.triggers?.length && (
                <Text size="xs" c="dimmed">
                  Trigger words: {item.triggers.join(", ")}
                </Text>
              )}
            </Stack>
            <Button
              size="compact-sm"
              variant="default"
              disabled={added || assistance.isPending}
              aria-label={`Apply ${item.title || item.name}`}
              onClick={() => apply(item)}
            >
              {added ? "Added" : "Apply"}
            </Button>
          </Group>
        );
      })}
    </Stack>
  ) : null;
  return { action, suggestions: list };
}
