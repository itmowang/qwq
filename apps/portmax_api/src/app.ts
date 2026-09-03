import "dotenv/config";
import { Hono } from "hono";
import { createMcpTransport } from "./mcp.js";
import { forwardUpstream, selectForwardHeaders, selectResponseHeaders } from "./proxy.js";

export const app = new Hono();
const { server: mcpServer, transport: mcpTransport } = createMcpTransport();
await mcpServer.connect(mcpTransport);

app.get("/health", (c) =>
  c.json({
    name: "portmax_api",
    status: "ok",
    upstreamConfigured: Boolean(process.env.PORTMAX_UPSTREAM_BASE_URL),
  }),
);

app.all("/mcp", (c) => mcpTransport.handleRequest(c.req.raw));

app.all("/proxy/*", async (c) => {
  const path = c.req.path.slice("/proxy".length);
  if (path === "/" || !path) {
    return c.json({ error: "Provide an upstream path after /proxy." }, 400);
  }

  try {
    const method = c.req.method;
    const body = method === "GET" || method === "HEAD" ? undefined : await c.req.raw.arrayBuffer();
    const upstreamResponse = await forwardUpstream({
      path: `${path}${new URL(c.req.url).search}`,
      method,
      headers: Object.fromEntries(selectForwardHeaders(c.req.raw.headers)),
      body,
    });

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: selectResponseHeaders(upstreamResponse.headers),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upstream request failed.";
    return c.json({ error: message }, 502);
  }
});

app.notFound((c) => c.json({ error: "Not found" }, 404));
