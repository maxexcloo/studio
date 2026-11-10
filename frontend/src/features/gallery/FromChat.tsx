import { Anchor, Group } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { MessageCircle } from "lucide-react";
import { Link } from "react-router";
import type { MediaItem } from "../../types";
import { chatTitle } from "../sessions/ChatActions";
import { sessionsQuery } from "../sessions/queries";

/**
 * "From Chat: Fox Ideas": the Chat a result joined, named by the client that asked (an MCP set's
 * `source`), linking to the turn that made it.
 */
export function FromChat({ item }: { item: Pick<MediaItem, "sessionId" | "jobId" | "resultSet"> }) {
  const title = useQuery({
    ...sessionsQuery,
    select: (data) => {
      const session = data.sessions.find((candidate) => candidate.id === item.sessionId);
      return session && chatTitle(session);
    },
    enabled: Boolean(item.sessionId),
  }).data;
  if (!item.sessionId) return null;
  const label = `From ${item.resultSet?.source || "Chat"}${title ? `: ${title}` : ""}`;
  return (
    <Anchor
      component={Link}
      to={`/chat/${item.sessionId}${item.jobId ? `#job-${item.jobId}` : ""}`}
      inherit
      c="dimmed"
      underline="always"
    >
      <Group gap={4} wrap="nowrap" component="span" miw={0}>
        <MessageCircle size={12} style={{ flexShrink: 0 }} />
        <span>{label}</span>
      </Group>
    </Anchor>
  );
}
