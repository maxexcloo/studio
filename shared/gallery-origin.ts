/** Origins recorded on gallery results; unmarked work has no known origin. */
export const galleryOrigins = [
  { value: "chat", label: "Chat" },
  { value: "dream", label: "Dream" },
];

export function galleryOrigin(item: {
  chat?: { conversationId?: string };
  dream?: unknown;
  resultSet?: { source?: string };
}) {
  if (item.dream || item.resultSet?.source === "dream") return "dream";
  if (item.chat?.conversationId) return "chat";
  return "";
}
