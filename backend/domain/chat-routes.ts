import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import type { ChatInput } from "../../shared/chat.ts";
import { ChatService } from "./chat.ts";

/** Mount after account authentication. Policy callback applies the existing assistant/model gates. */
export function createChatRouter(
  service: ChatService,
  authorize: (request: Request) => string | Promise<string>,
) {
  const router = Router();
  router.get("/chat/status", async (request, response) => {
    try {
      const owner = await authorize(request);
      response.json(await service.status(owner));
    } catch (error) {
      response.json({
        available: false,
        models: [],
        reason: error instanceof Error ? error.message : "Chat is unavailable.",
      });
    }
  });
  router.get("/sessions/:id/chat", async (request, response, next) => {
    try {
      const owner = await authorize(request);
      response.json({
        ...(await service.status(owner)),
        messages: service.messages(owner, String(request.params.id)),
      });
    } catch (error) {
      next(error);
    }
  });
  // A dropped connection leaves the reply running and stored; the client reloads it on return.
  router.post("/sessions/:id/chat", async (request, response, next) => {
    try {
      const owner = await authorize(request);
      const emit = (event: { event: string; data: unknown }) => {
        if (response.destroyed) return;
        if (!response.headersSent) {
          response.setHeader("Content-Type", "text/event-stream");
          response.setHeader("Cache-Control", "no-cache");
          response.setHeader("X-Accel-Buffering", "no");
        }
        response.write(`event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`);
      };
      try {
        await service.stream(owner, String(request.params.id), request.body as ChatInput, emit);
      } catch (error) {
        if (!response.headersSent) throw error;
        if (!(error instanceof Error && error.name === "AbortError"))
          emit({
            event: "error",
            data: {
              error:
                error instanceof Error && "status" in error
                  ? error.message
                  : "The text response could not be completed.",
            },
          });
      }
      response.end();
    } catch (error) {
      next(error);
    }
  });
  router.post("/sessions/:id/chat/stop", async (request, response, next) => {
    try {
      const owner = await authorize(request);
      response.json({ stopped: service.stop(owner, String(request.params.id)) });
    } catch (error) {
      next(error);
    }
  });
  router.use((error: unknown, _request: Request, response: Response, next: NextFunction) => {
    if (response.headersSent) return next(error);
    const status = Number((error as { status?: number })?.status);
    response.status(status >= 400 && status < 600 ? status : 500).json({
      error:
        error instanceof Error && status >= 400 && status < 600
          ? error.message
          : "Chat could not complete this request.",
    });
  });
  return router;
}
