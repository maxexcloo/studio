import { Text } from "@mantine/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { type ComponentProps, useRef, useState } from "react";

import {
  type ProjectBriefTextField,
  type ProjectContent,
  maxProjectBrief,
} from "../../../../shared/projects";
import { post } from "../../api";
import { icons } from "../../ui/icons";
import { TextBox } from "../../ui/TextBox";
import { proposalUndo } from "../generation/AskChange";
import { changeSummary } from "../generation/changeSummary";
import { assistantQuery } from "../generation/PromptAssistant";

type Context = Pick<ProjectContent, "name" | "brief">;

export function ProjectBriefField({
  field,
  draft,
  onChange,
  ...props
}: Pick<ComponentProps<typeof TextBox>, "label" | "description" | "inline" | "autosize"> & {
  field: ProjectBriefTextField;
  draft: Context;
  onChange: (value: string) => void;
}) {
  const assistant = useQuery(assistantQuery);
  const value = draft.brief[field] || "";
  const latest = useRef(draft);
  latest.current = draft;
  const [proposal, setProposal] = useState<{ before: string; after: string }>();
  const shown = proposal?.after === value ? proposal : undefined;
  const summary = shown?.before && changeSummary(shown.before, shown.after);
  const change = (text: string) => {
    setProposal(undefined);
    onChange(text);
  };
  const write = useMutation({
    mutationFn: ({ name, brief }: Context) =>
      post<{ text: string }>("/api/assistant/project-brief", { name, brief, field }),
  });
  // Each brief box offers its own, so the action names its field.
  const label = `${value.trim() ? "Improve" : "Suggest"} ${props.label}`;
  const writeAction = {
    id: "write",
    icon: icons.assistant,
    label,
    disabled: write.isPending,
    onClick: () =>
      write.mutate(draft, {
        onSuccess: ({ text }, sent) => {
          if (latest.current.brief !== sent.brief || latest.current.name !== sent.name) return;
          const before = shown?.before ?? sent.brief[field] ?? "";
          if (text !== value) {
            setProposal({ before, after: text });
            onChange(text);
          }
        },
      }),
  };
  const tool = {
    id: "assistant",
    icon: icons.assistant,
    label,
    heading: false,
    menu: [...proposalUndo(shown && (() => change(shown.before))), [writeAction]],
  };
  return (
    <TextBox
      {...props}
      minRows={2}
      maxLength={maxProjectBrief}
      value={value}
      onChange={change}
      tools={assistant.data?.available ? [tool] : undefined}
      busy={write.isPending ? "Writing…" : undefined}
      below={
        shown && (
          <Text size="xs" c="dimmed" role="status">
            {shown.before ? "Improved" : "Suggested"}
            {summary && ` · ${summary}`}
          </Text>
        )
      }
    />
  );
}
