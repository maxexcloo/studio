import { useEffect, useRef, useState } from "react";
import { ActionIcon, Button, Group, Menu, Stack, Text, Tooltip } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Sparkles, Square } from "lucide-react";
import { api, failure, request } from "../../api";
import type { GenerationInput, Profile, ReferenceAsset } from "../../types";

interface AssistantStatus {
  available: boolean;
  presets: { id: string; label: string; description?: string }[];
  defaultPreset?: string;
  vision?: boolean;
  loras?: boolean;
  noNegative?: string[];
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
  const status = useQuery({
    queryKey: ["assistant"],
    queryFn: () => api<AssistantStatus>("/api/assistant"),
    retry: false,
  });
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
            size="compact-xs"
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
    mutationFn: async (action: Action) => {
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
        body.preset = preset?.id;
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
        throw new Error(result.reason || "Prompt assistance is unavailable.");
      return { action, result, source, preset: preset?.id };
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
    const triggers = (suggestion.triggers || []).filter((trigger) => {
      const escaped = trigger.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return trigger.trim() && !new RegExp(`(?:^|\\W)${escaped}(?:$|\\W)`, "i").test(input.prompt);
    });
    applyChange("LoRA applied", {
      loras: [
        ...input.loras,
        { name: suggestion.name, strength: suggestion.strength, enabled: true },
      ],
      ...(triggers.length
        ? { prompt: [input.prompt.trim(), ...triggers].filter(Boolean).join(", ") }
        : {}),
    });
  }
  if (!info?.available || !profile || !info.presets.length)
    return { action: null, suggestions: null };
  const disabled = !input.prompt.trim() || assistance.isPending;
  const action = assistance.isPending ? (
    <Tooltip label="Stop Assistance">
      <ActionIcon
        variant="subtle"
        color="gray"
        aria-label="Stop Assistance"
        onClick={() => {
          controller.current?.abort();
          notifications.show({ message: "Assistance stopped" });
        }}
      >
        <Square size={14} />
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
        <Menu.Item disabled={disabled} onClick={() => assistance.mutate("rewrite")}>
          Improve Prompt
        </Menu.Item>
        {negativeOffered && (
          <Menu.Item disabled={disabled} onClick={() => assistance.mutate("negative")}>
            Write Negative
          </Menu.Item>
        )}
        {lorasOffered && (
          <Menu.Item disabled={disabled} onClick={() => assistance.mutate("loras")}>
            Suggest LoRAs
          </Menu.Item>
        )}
        {info.presets.length > 1 && (
          <>
            <Menu.Divider />
            <Menu.Label>Assistance Style</Menu.Label>
            <Menu.RadioGroup value={preset?.id} onChange={setPresetId}>
              {info.presets.map((item) => (
                <Menu.RadioItem key={item.id} value={item.id}>
                  {item.label}
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
          </>
        )}
        {!!references.length && (
          <Text size="xs" c="dimmed" px="sm" py={6}>
            {info.vision
              ? "Selected references are shared with the assistant when improving the prompt."
              : "This assistant improves text without reading references."}
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
              size="compact-xs"
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
