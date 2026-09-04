import "dotenv/config";
import { Hono } from "hono";
import { httpRoutes } from "./http/routes.js";
import { createMcpTransport } from "./mcp/index.js";

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
app.route("/", httpRoutes);

app.notFound((c) => c.json({ error: "Not found" }, 404));
