import { Button, Group, Text } from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { queryOptions, useMutation, useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { maxLoras } from "../../../../shared/profiles";
import type { ImageChangeAction } from "../../../../shared/suggestions";
import { api, failure, request } from "../../api";
import type { GenerationInput, Profile, ReferenceAsset } from "../../types";
import type { Action as ToolAction } from "../../ui/ActionBar";
import { icons } from "../../ui/icons";
import { assistMenu, suggested } from "./AskChange";
import { CustomDialog } from "./CustomDialog";
import { profileForLoras } from "./payload";

/** A fixed assistant option from Library › Prompt Styles, in its menu's order. */
export interface AssistantOption {
  id: string;
  label: string;
  /** Offered only to accounts with Uncensored Models. */
  uncensored?: boolean;
}
export interface AssistantChangeOption extends AssistantOption {
  instruction: string;
  actions?: ImageChangeAction[];
}
interface AssistantStatus {
  available: boolean;
  /** Improve Prompt's styles, then Custom. */
  presets: AssistantOption[];
  /** Animate's themes, then Custom. */
  themes: (AssistantOption & { instruction?: string })[];
  /** Fixed AI edits, each run as its instruction. */
  changes: AssistantChangeOption[];
  defaultPreset?: string;
  vision?: boolean;
  loras?: boolean;
  noNegative?: string[];
  /** The account holds Uncensored Models. */
  uncensored?: boolean;
  /** The text models it may pick and the one its writing asks for. */
  models?: string[];
  writingModel?: string;
  defaultTextSide?: "cloud" | "local";
}
interface Suggestion {
  name: string;
  strength: number;
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
type Action = "rewrite" | "negative";
const workingLabels: Record<Action, string> = {
  rewrite: "Improving Prompt…",
  negative: "Writing Negative…",
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
 * doing, its Custom… dialog and Suggest LoRAs, which adds the LoRAs that fit the prompt.
 */
export function usePromptAssistant({
  input,
  profile,
  onChange,
  onNegativeWritten,
  references = [],
  scopeKey = "",
  change,
}: {
  input: GenerationInput;
  profile?: Profile;
  onChange: (patch: Partial<GenerationInput>) => void;
  onNegativeWritten?: () => void;
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
    suggestions?: (
      pick: (request: string) => void,
      render: (action: ToolAction) => ReactNode,
    ) => ReactNode;
  };
}) {
  const status = useQuery(assistantQuery);
  // Custom… asks what to change first.
  const [asking, setAsking] = useState(false);
  // A custom rewrite lands in the prompt box with the caret at its end, ready to edit.
  const editAfter = useRef(false);
  // The style last used comes first and is marked, so repeating it is one click.
  const [presetId, setPresetId] = useState<string | null>(null);
  const [loraFeedback, setLoraFeedback] = useState<{ message: string; error?: boolean }>();
  const [negativeIdea, setNegativeIdea] = useState<{ key: string; value: string }>();
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const scope = useRef(0);
  const undoNotifications = useRef(new Set<string>());
  const hasReferences = Boolean(
    references.length || input.referenceAssets?.length || input.referenceDetails?.length,
  );
  const loraProfile = profileForLoras(profile, input.profileBackend, hasReferences);
  const latest = useRef({
    input,
    profile,
    hasReferences,
    loraProfile,
    onChange,
    onNegativeWritten,
  });
  latest.current = { input, profile, hasReferences, loraProfile, onChange, onNegativeWritten };
  useEffect(() => {
    mounted.current = true;
    scope.current++;
    setLoraFeedback(undefined);
    return () => {
      mounted.current = false;
      scope.current++;
      controller.current?.abort();
      undoNotifications.current.forEach((id) => notifications.hide(id));
      undoNotifications.current.clear();
    };
  }, [profile?.id, input.profileBackend, hasReferences, scopeKey]);
  const info = status.data;
  const preset =
    info?.presets.find((item) => item.id === presetId) ||
    info?.presets.find((item) => item.id === info.defaultPreset) ||
    info?.presets[0];
  const negativeOffered =
    profile?.capabilities.negativePrompt !== false &&
    !info?.noNegative?.includes(profile?.id || "");
  const negativeKey = JSON.stringify([profile?.id, input.prompt, input.cfg, input.loras]);
  const lorasOffered = Boolean(
    info?.loras && loraProfile?.capabilities.lora && loraProfile.options?.loras?.length,
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
      preview,
    }: {
      action: Action;
      preset?: string;
      instruction?: string;
      preview?: boolean;
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
      const body: Record<string, unknown> = {
        profileId: profile.id,
        prompt: input.prompt,
        loras: input.loras.filter((item) => item.enabled !== false).map((item) => item.name),
      };
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
      if (result.source === "fallback")
        throw new Error(`The prompt assistant is unavailable (${result.reason || "no reply"}).`);
      return { action, result, source, preset, preview, negativeKey };
    },
    onSuccess: ({ action, result, source, preset, preview, negativeKey }) => {
      if (!mounted.current || source.scope !== scope.current) return;
      const current = latest.current;
      if (
        current.profile?.id !== source.profileId ||
        current.input.prompt !== source.prompt ||
        (action === "negative" && !preview && current.input.negative !== source.negative)
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
      } else {
        if (preview) {
          setNegativeIdea({ key: negativeKey, value: result.negative?.trim() || "" });
          return;
        }
        if (result.unused || !result.negative?.trim()) {
          notifications.show({ message: "This model does not use a negative prompt." });
          return;
        }
        applyChange("Negative prompt written", { negative: result.negative });
        current.onNegativeWritten?.();
      }
    },
    onSettled: () => {
      controller.current = null;
    },
  });
  const findLoras = useMutation({
    mutationKey: ["prompt-assistance", "loras"],
    meta: { inlineError: true },
    mutationFn: async ({
      scope: _scope,
      ...body
    }: {
      scope: number;
      profileId: string;
      profileBackend: GenerationInput["profileBackend"];
      hasReferences: boolean;
      prompt: string;
    }) => {
      const abort = new AbortController();
      controller.current = abort;
      const result = await api<Result>("/api/assistant/loras", {
        method: "POST",
        signal: abort.signal,
        body: JSON.stringify(body),
      });
      abort.signal.throwIfAborted();
      return result;
    },
    onSuccess: (result, source) => {
      if (!mounted.current || source.scope !== scope.current) return;
      const current = latest.current;
      if (
        current.profile?.id !== source.profileId ||
        current.input.profileBackend !== source.profileBackend ||
        current.hasReferences !== source.hasReferences
      )
        return;
      if (current.input.prompt !== source.prompt) {
        setLoraFeedback({ message: "Your prompt changed. Try again to use the current text." });
        return;
      }
      const offered = new Set(current.loraProfile?.options?.loras || []);
      const usable = (result.loras || []).filter((item) => offered.has(item.name));
      if (!usable.length)
        return setLoraFeedback({
          message: result.loras?.length
            ? "The suggested LoRAs are no longer available for the selected model."
            : result.reason || "No LoRAs fit this prompt.",
        });
      const loras = current.input.loras;
      const room =
        (current.loraProfile?.maxLoras || maxLoras) -
        loras.filter((item) => item.enabled !== false).length;
      const added = usable
        .filter((item) => !loras.some((lora) => lora.name === item.name))
        .slice(0, Math.max(0, room));
      if (!added.length)
        return setLoraFeedback({
          message:
            room > 0
              ? "The suggested LoRAs are already in the stack."
              : "Disable or remove a LoRA before adding another.",
        });
      // Studio adds enabled LoRAs' trigger words when it runs the prompt.
      applyChange(added.length === 1 ? "LoRA added" : "LoRAs added", {
        loras: [
          ...loras,
          ...added.map((item) => ({ name: item.name, strength: item.strength, enabled: true })),
        ],
      });
    },
    onError: (error, source) => {
      if (mounted.current && source.scope === scope.current && error.name !== "AbortError")
        setLoraFeedback({ message: error.message, error: true });
    },
    onSettled: () => {
      controller.current = null;
    },
  });
  const assisting = assistance.isPending || findLoras.isPending;
  // The LoRA chip keeps still while the prompt is typed, reading it when asked.
  const loraDisabled = !input.prompt.trim() || assisting || change?.pending;
  const loraSuggestions = useMemo(
    () =>
      lorasOffered
        ? {
            disabled: loraDisabled,
            loading: findLoras.isPending,
            feedback: loraFeedback,
            onClick: () => {
              const { input, profile, hasReferences } = latest.current;
              if (!profile) return;
              setLoraFeedback(undefined);
              findLoras.mutate({
                scope: scope.current,
                profileId: profile.id,
                profileBackend: input.profileBackend,
                hasReferences,
                prompt: input.prompt,
              });
            },
          }
        : undefined,
    [lorasOffered, loraDisabled, findLoras.isPending, findLoras.mutate, loraFeedback],
  );
  if (!info?.available || !profile || !info.presets.length)
    return { working: undefined, dialog: null };
  const disabled = !input.prompt.trim();
  const run = (action: Action, style?: string) => {
    if (assisting) return;
    if (style) setPresetId(style);
    assistance.mutate({ action, preset: style });
  };
  const custom = change || info.presets.some((item) => item.id === "custom");
  const styles = info.presets.filter((item) => item.id !== "custom");
  const templates: ToolAction[] = styles.map((item) => ({
    id: `style:${item.id}`,
    label: styles.length === 1 ? "Improve Prompt" : item.label,
    marker: item.uncensored ? icons.uncensored : undefined,
    checked: styles.length > 1 ? item.id === preset?.id : undefined,
    disabled,
    onClick: () => run("rewrite", item.id),
  }));
  const customActions: ToolAction[] = custom
    ? [
        {
          id: "custom",
          label: "Custom…",
          icon: icons.custom,
          // A change can write a prompt from nothing; the Custom style rewrites one.
          disabled: !change && disabled,
          onClick: () => setAsking(true),
        },
      ]
    : [];
  const more: ToolAction[] = negativeOffered
    ? [{ id: "negative", label: "Write Negative", disabled, onClick: () => run("negative") }]
    : [];
  const working = change?.pending
    ? "Asking for a Change…"
    : findLoras.isPending
      ? "Finding LoRAs…"
      : assistance.isPending && assistance.variables
        ? workingLabels[assistance.variables.action]
        : undefined;
  // While it works the box's ⋯ spins and this offers Stop. A change can't be stopped.
  const stop: ToolAction | undefined = assisting
    ? {
        id: "assistant",
        label: "Stop Assistance",
        icon: icons.stop,
        onClick: () => controller.current?.abort(),
      }
    : undefined;
  // A change lands in the prompt as a proposal; the Custom style's rewrite, ready to edit.
  function ask(text: string) {
    if (change) change.send(text);
    else if (!assisting) {
      editAfter.current = true;
      // Not remembered as the last style, which runs from one tap.
      assistance.mutate({ action: "rewrite", preset: "custom", instruction: text });
    }
  }
  const dialog = (
    <CustomDialog
      opened={asking}
      onClose={() => setAsking(false)}
      title="Custom Improvement"
      action="Improve Prompt"
      onSend={ask}
      suggestions={change?.suggestions}
    />
  );
  const preview = negativeIdea?.key === negativeKey ? negativeIdea.value : undefined;
  const loadNegative = () => {
    if (!assisting) assistance.mutate({ action: "negative", preview: true });
  };
  const negativeFailed = assistance.isError && assistance.variables?.action === "negative";
  const negativeTool: ToolAction | undefined = negativeOffered
    ? {
        id: "negative-assistant",
        label: "Improve Negative Prompt",
        icon: icons.assistant,
        onOpen: () => {
          if (!disabled && preview === undefined) loadNegative();
        },
        menu: assistMenu({
          suggestions: suggested(
            preview
              ? [
                  {
                    id: "negative-idea",
                    label: preview,
                    onClick: () => applyChange("Negative prompt written", { negative: preview }),
                  },
                ]
              : [],
            {
              loading: assisting,
              answered: preview !== undefined || negativeFailed,
              failure: negativeFailed ? assistance.error.message : undefined,
              disabled,
              onRefresh: loadNegative,
            },
          ),
          templates: [],
          last: [],
        }),
      }
    : undefined;
  return {
    templates,
    custom: customActions,
    more,
    stop,
    working,
    dialog,
    loraSuggestions,
    negativeTool,
  };
}
