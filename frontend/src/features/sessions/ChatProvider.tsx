import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import type { ChatEvent, ChatInput, ChatMessage, ChatStatus } from "../../../../shared/chat";
import { api, post, request } from "../../api";
import type { Session } from "../../types";
import { useGeneration } from "../generation/GenerationProvider";
import { generationInput } from "../generation/payload";

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
  const { draft, setDraft, profile, setPrepared } = useGeneration();
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
        const result = await post<{ session: Session }>("/api/sessions", {
          title: content.slice(0, 80),
          inputs: input,
        });
        sessionId = result.session.id;
        setDraft((value) => ({ ...value, sessionId }));
        void client.invalidateQueries({ queryKey: ["sessions"] });
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
      if (!override?.content) setText("");
      await readChat(response, (event) => {
        if (event.event === "message" || event.event === "delta") {
          void client.cancelQueries({ queryKey: ["chat", sessionId] });
          client.setQueryData<ChatHistory>(["chat", sessionId], (previous) => {
            const messages = [...(previous?.messages || [])];
            const index = messages.findIndex((message) => message.id === event.data.id);
            if (event.event === "message") {
              if (index < 0) messages.push(event.data);
              else messages[index] = event.data;
            } else if (index >= 0)
              messages[index] = {
                ...messages[index],
                content: messages[index].content + event.data.text,
              };
            return { ...previous, available: true, messages };
          });
        } else if (event.event === "generation") {
          generated = true;
          setPrepared(false);
          setDraft((previous) => ({ ...previous, parentJobId: event.data.job.id }));
          void client.invalidateQueries({ queryKey: ["session", sessionId] });
          void client.invalidateQueries({ queryKey: ["queue"] });
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
export function ChatProvider({ children }: { children: ReactNode }) {
  return <Context.Provider value={useChatState()}>{children}</Context.Provider>;
}
export function useChat() {
  return useContext(Context)!;
}
export function useChatMessages(id?: string) {
  const { sendingSession } = useChat();
  return useQuery({
    queryKey: ["chat", id],
    queryFn: () => api<ChatHistory>(`/api/sessions/${id}/chat`),
    enabled: !!id,
    refetchOnWindowFocus: false,
    refetchInterval: sendingSession === id ? false : 3000,
  });
}
