import { handleChatStream } from "@mastra/ai-sdk";
import { registerApiRoute } from "@mastra/core/server";
import { createUIMessageStreamResponse } from "ai";
import { DocumentAttachmentError, transformDocumentAttachments } from "./document-message-transform.js";

function documentErrorResponse(error: DocumentAttachmentError): Response {
  return new Response(JSON.stringify({ error: error.message }), {
    status: error.status,
    headers: { "content-type": "application/json" },
  });
}

export const portmaxChatRoute = registerApiRoute("/chat/:agentId", {
  method: "POST",
  async handler(c) {
    try {
      const request = await transformDocumentAttachments(await c.req.json());
      const stream = await handleChatStream({
        mastra: c.get("mastra"),
        agentId: c.req.param("agentId"),
        params: {
          ...request,
          requestContext: c.get("requestContext"),
          abortSignal: c.req.raw.signal,
        } as never,
        version: "v5",
      });

      // Mastra's chat adapter produces the v5 UI stream that the desktop's
      // DefaultChatTransport consumes. AI SDK's public types use a newer
      // internal chunk type, so bridge the compatible wire format here.
      return createUIMessageStreamResponse({ stream: stream as never });
    } catch (error) {
      if (error instanceof DocumentAttachmentError) return documentErrorResponse(error);
      throw error;
    }
  },
});
