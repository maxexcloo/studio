import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Group, Modal, Stack, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { queryOptions, useMutation, useQuery } from "@tanstack/react-query";
import { icons } from "../../ui/icons";
import { api, failure, request } from "../../api";
import { TextBox } from "../../ui/TextBox";
import { usePhone } from "../../ui/usePhone";
import type { GenerationInput, Profile, ReferenceAsset } from "../../types";
import type { Action as ToolAction } from "../gallery/ActionBar";

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

/**
 * The prompt box's assistance tool (Improve Prompt, Stop Assistance while it works), what it is
 * doing, its Custom… dialog and any LoRA suggestions it produced.
 */
export function usePromptAssistant({
  input,
  profile,
  onChange,
  references = [],
  scopeKey = "",
  change,
}: {
  input: GenerationInput;
  profile?: Profile;
  onChange: (patch: Partial<GenerationInput>) => void;
  references?: ReferenceAsset[];
  scopeKey?: string;
  /**
   * Sends Custom…'s text as a change to the draft (`useDraftChange`), proposed in the prompt for
   * Undo, with `suggestions` (given what picking one does) beside the text. Without it, Custom…
   * rewrites with the Custom style.
   */
  change?: {
    send: (request: string) => void;
    pending: boolean;
    suggestions?: (pick: (request: string) => void) => ReactNode;
  };
}) {
  const status = useQuery(assistantQuery);
  const phone = usePhone();
  // Custom… asks what to change first; the last request stays for the next time.
  const [asking, setAsking] = useState(false);
  const [instruction, setInstruction] = useState("");
  // A custom rewrite lands in the prompt box with the caret at its end, ready to edit.
  const editAfter = useRef(false);
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
    mutationFn: async ({
      action,
      preset,
      instruction,
    }: {
      action: Action;
      preset?: string;
      instruction?: string;
    }) => {
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
        if (instruction) body.instruction = instruction;
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
          message: "Your inputs changed while the assistant worked. Try again to use them.",
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
        if (editAfter.current) {
          editAfter.current = false;
          requestAnimationFrame(() => {
            const field = document.querySelector<HTMLTextAreaElement>(
              "textarea[data-expanded-prompt]",
            );
            field?.focus();
            field?.setSelectionRange(field.value.length, field.value.length);
          });
        }
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
    return { action: null, working: undefined, dialog: null, suggestions: null };
  const disabled = !input.prompt.trim();
  const run = (action: Action, style?: string) => {
    if (style) setPresetId(style);
    assistance.mutate({ action, preset: style });
  };
  // Styles A–Z, with Custom… last: a change to the draft where there is one, else the Custom style.
  const custom = change || info.presets.some((item) => item.id === "custom");
  const styles = info.presets
    .filter((item) => item.id !== "custom")
    .sort((a, b) => a.label.localeCompare(b.label));
  const improve: ToolAction[] = [
    // Each style is a choice that runs at once; the last one used carries a check.
    ...(styles.length > 1
      ? styles.map((item) => ({
          id: `style:${item.id}`,
          label: item.label,
          checked: item.id === preset?.id,
          disabled,
          onClick: () => run("rewrite", item.id),
        }))
      : [
          {
            id: "improve",
            label: "Improve Prompt",
            disabled,
            onClick: () => run("rewrite", preset?.id),
          },
        ]),
    ...(custom
      ? [
          {
            id: "custom",
            label: "Custom…",
            // A change can write a prompt from nothing; the Custom style rewrites one.
            disabled: !change && disabled,
            onClick: () => setAsking(true),
          },
        ]
      : []),
  ];
  const more: ToolAction[] = [
    ...(lorasOffered
      ? [{ id: "loras", label: "Suggest LoRAs", disabled, onClick: () => run("loras") }]
      : []),
    ...(negativeOffered
      ? [{ id: "negative", label: "Write Negative", disabled, onClick: () => run("negative") }]
      : []),
  ];
  const working = change?.pending
    ? "Asking for a Change…"
    : assistance.isPending && assistance.variables
      ? workingLabels[assistance.variables.action]
      : undefined;
  // While it works the box's ⋯ spins and this offers Stop. A change can't be stopped.
  const action: ToolAction = assistance.isPending
    ? {
        id: "assistant",
        label: "Stop Assistance",
        icon: icons.stop,
        onClick: () => controller.current?.abort(),
      }
    : {
        id: "assistant",
        label: "Improve Prompt",
        icon: icons.assistant,
        disabled: change?.pending,
        menu: [improve, more],
      };
  // A change lands in the prompt as a proposal; the Custom style's rewrite, ready to edit.
  function ask(text: string) {
    setAsking(false);
    if (change) change.send(text);
    else {
      editAfter.current = true;
      // Not remembered as the last style, which runs from one tap.
      assistance.mutate({ action: "rewrite", preset: "custom", instruction: text });
    }
  }
  const dialog = (
    <Modal
      opened={asking}
      onClose={() => setAsking(false)}
      title="Custom Improvement"
      centered
      size="sm"
      fullScreen={phone}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          // React carries a submit through the portal to the composer's own form, which would Generate.
          event.stopPropagation();
          if (instruction.trim()) ask(instruction.trim());
        }}
      >
        <Stack>
          <TextBox
            label="Change"
            placeholder="What should change, like “make it night”"
            autosize
            minRows={3}
            // The dialog is already full screen on phones.
            inline
            data-autofocus
            value={instruction}
            onChange={setInstruction}
            // Enter improves the prompt; Shift+Enter adds a line.
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }}
          />
          <Group justify="flex-end">
            {/* A suggestion fills the request and asks at once. */}
            {change?.suggestions?.((request) => {
              setInstruction(request);
              ask(request);
            })}
            <Button type="submit" disabled={!instruction.trim()}>
              Improve Prompt
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
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
  return { action, working, dialog, suggestions: list };
}
