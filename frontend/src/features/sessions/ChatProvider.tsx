import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import type { ChatEvent, ChatInput, ChatMessage, ChatStatus } from "../../../../shared/chat";
import { api, post, request } from "../../api";
import type { Session } from "../../types";
import { useGeneration } from "../generation/GenerationProvider";
import { generationInput } from "../generation/payload";
import { queueQuery } from "../generation/Queue";
import { sessionQuery, sessionsQuery } from "./queries";

interface ChatHistory {
  messages: ChatMessage[];
  available: boolean;
  reason?: string;
}

async function readChat(response: Response, receive: (event: ChatEvent) => void) {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      let boundary: RegExpExecArray | null;
      while ((boundary = /\r?\n\r?\n/.exec(buffer))) {
        const block = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.index + boundary[0].length);
        const lines = block.split(/\r?\n/);
        const event =
          lines
            .find((line) => line.startsWith("event:"))
            ?.slice(6)
            .trim() || "message";
        const data = lines
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (data) receive({ event, data: JSON.parse(data) } as ChatEvent);
      }
      if (chunk.done) break;
    }
  } finally {
    reader.releaseLock();
  }
}

function useChatState() {
  const client = useQueryClient(),
    navigate = useNavigate();
  const { draft, setDraft, profile } = useGeneration();
  const [text, setText] = useState("");
  const [sendingSession, setSendingSession] = useState("");
  const [error, setError] = useState("");
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const status = useQuery({
    queryKey: ["chat-status"],
    queryFn: () => api<ChatStatus>("/api/chat/status"),
    refetchInterval: 15000,
  });
  useEffect(() => () => active.current?.abort(), []);

  const modelId = selectedModel || status.data?.defaultModelId || status.data?.models?.[0]?.id;
  async function send(override?: Partial<ChatInput>, targetSessionId?: string) {
    const content = (override?.content ?? text).trim();
    if (!content || active.current) return false;
    let generated = false;
    const controller = new AbortController();
    active.current = controller;
    setSendingSession(draft.sessionId || "new");
    setError("");
    let sessionId = targetSessionId || draft.sessionId;
    try {
      const input = generationInput(draft.input, profile, draft.references);
      if (!sessionId) {
        // The chat stays New Chat until its generated title arrives after the first reply.
        const result = await post<{ session: Session }>("/api/sessions", { inputs: input });
        sessionId = result.session.id;
        // The new chat opens at once instead of loading what is already known.
        client.setQueryData(sessionQuery(sessionId).queryKey, {
          session: result.session,
          jobs: [],
        });
        client.setQueryData<ChatHistory>(["chat", sessionId], { available: true, messages: [] });
        client.setQueryData(sessionsQuery.queryKey, (data) =>
          data ? { sessions: [result.session, ...data.sessions] } : data,
        );
        setDraft((value) => ({ ...value, sessionId }));
        void client.invalidateQueries({ queryKey: sessionsQuery.queryKey });
      }
      setSendingSession(sessionId);
      navigate(`/chat/${sessionId}`);
      const body: ChatInput = {
        content,
        references: draft.references.map((asset) => asset.id),
        generation: { input, operation: draft.operation, parentJobId: draft.parentJobId },
        modelId,
        ...override,
      };
      const response = await request(`/api/sessions/${sessionId}/chat`, {
        method: "POST",
        body: JSON.stringify(body),
        signal: controller.signal,
        headers: { Accept: "text/event-stream" },
      });
      if (!override?.content) setText((current) => (current.trim() === content ? "" : current));
      await readChat(response, (event) => {
        if (event.event === "message" || event.event === "delta" || event.event === "thinking") {
          void client.cancelQueries({ queryKey: ["chat", sessionId] });
          client.setQueryData<ChatHistory>(["chat", sessionId], (previous) => {
            const messages = [...(previous?.messages || [])];
            const index = messages.findIndex((message) => message.id === event.data.id);
            if (event.event === "message") {
              if (index < 0) messages.push(event.data);
              else messages[index] = event.data;
            } else if (index >= 0 && event.event === "thinking")
              messages[index] = {
                ...messages[index],
                thinking: (messages[index].thinking || "") + event.data.text,
              };
            else if (index >= 0)
              messages[index] = {
                ...messages[index],
                content: messages[index].content + event.data.text,
              };
            return { ...previous, available: true, messages };
          });
        } else if (event.event === "generation") {
          generated = true;
          setDraft((previous) => ({
            ...previous,
            parentJobId: event.data.job.id,
            parentItemId: undefined,
          }));
          void client.invalidateQueries({ queryKey: ["session", sessionId] });
          void client.invalidateQueries({ queryKey: queueQuery.queryKey });
          void client.invalidateQueries({ queryKey: ["gallery"] });
        } else if (event.event === "error") setError(event.data.error);
      });
    } catch (error) {
      if (!controller.signal.aborted)
        setError(error instanceof Error ? error.message : String(error));
    } finally {
      active.current = null;
      setSendingSession("");
      if (sessionId) {
        void client.invalidateQueries({ queryKey: ["chat", sessionId] });
        void client.invalidateQueries({ queryKey: ["session", sessionId] });
        void client.invalidateQueries({ queryKey: sessionsQuery.queryKey });
      }
    }
    return generated;
  }
  return {
    text,
    setText,
    send,
    sendingSession,
    error,
    status,
    modelId,
    selectModel: setSelectedModel,
    stop: () => active.current?.abort(),
  };
}
const Context = createContext<ReturnType<typeof useChatState> | null>(null);
type ChatState = ReturnType<typeof useChatState>;
const ChatControllerContext = createContext<{
  send: ChatState["send"];
  sendingSession: string;
  status: Pick<ChatState["status"], "data" | "isPending" | "isError">;
} | null>(null);

export function ChatProvider({ children }: { children: ReactNode }) {
  const value = useChatState();
  const latestStateRef = useRef(value);
  latestStateRef.current = value;
  const send = useCallback<ChatState["send"]>(
    (override, targetSessionId) => latestStateRef.current.send(override, targetSessionId),
    [],
  );
  const status = useMemo(
    () => ({
      data: value.status.data,
      isPending: value.status.isPending,
      isError: value.status.isError,
    }),
    [value.status.data, value.status.isPending, value.status.isError],
  );
  const controller = useMemo(
    () => ({ send, sendingSession: value.sendingSession, status }),
    [send, value.sendingSession, status],
  );
  return (
    <ChatControllerContext.Provider value={controller}>
      <Context.Provider value={value}>{children}</Context.Provider>
    </ChatControllerContext.Provider>
  );
}
export function useChatController() {
  return useContext(ChatControllerContext)!;
}
export function useChat() {
  return useContext(Context)!;
}
export function useChatMessages(id?: string) {
  const { sendingSession } = useChatController();
  return useQuery({
    queryKey: ["chat", id],
    queryFn: () => api<ChatHistory>(`/api/sessions/${id}/chat`),
    enabled: !!id,
    refetchOnWindowFocus: false,
    // Follows a reply streaming elsewhere (another tab); idle chats do not poll.
    refetchInterval: (query) =>
      sendingSession !== id &&
      query.state.data?.messages.some((message) => message.status === "streaming")
        ? 2000
        : false,
  });
}
