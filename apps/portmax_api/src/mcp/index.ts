import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { forwardUpstream } from "../http/proxy.js";

const requestSchema = {
  path: z.string().startsWith("/").describe("Path and optional query string on the configured upstream."),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.unknown().optional().describe("JSON request body. Omit for requests without a body."),
};

export function createMcpTransport() {
  const server = new McpServer({ name: "portmax_api", version: "0.1.0" });

  server.registerTool(
    "request_upstream",
    {
      title: "Request configured upstream",
      description: "Calls an HTTP endpoint under PORTMAX_UPSTREAM_BASE_URL. The destination origin cannot be changed by callers.",
      inputSchema: requestSchema,
    },
    async ({ path, method, headers, body }) => {
      try {
        const requestHeaders = new Headers(headers);
        const serializedBody = body === undefined ? undefined : JSON.stringify(body);
        if (serializedBody && !requestHeaders.has("content-type")) {
          requestHeaders.set("content-type", "application/json");
        }

        const upstreamResponse = await forwardUpstream({
          path,
          method,
          headers: Object.fromEntries(requestHeaders),
          body: serializedBody,
        });
        const text = await upstreamResponse.text();
        const summary = JSON.stringify(
          {
            status: upstreamResponse.status,
            contentType: upstreamResponse.headers.get("content-type"),
            body: text,
          },
          null,
          2,
        );

        return {
          content: [{ type: "text", text: summary }],
          isError: !upstreamResponse.ok,
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : "Upstream request failed." }],
          isError: true,
        };
      }
    },
  );

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  return { server, transport };
}
