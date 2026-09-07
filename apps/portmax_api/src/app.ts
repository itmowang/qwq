import "dotenv/config";
import { Hono } from "hono";
import { httpRoutes } from "./http/routes.js";
import { createMcpTransport, type McpSessionCredentials } from "./mcp/index.js";

const maxCredentialLength = 4096;
const maxTenantIdLength = 128;

type McpSession = {
  transport: ReturnType<typeof createMcpTransport>["transport"];
  credentials: McpSessionCredentials | undefined;
  setCredentials: (credentials: McpSessionCredentials) => void;
};

export const app = new Hono();
const mcpSessions = new Map<string, McpSession>();

app.get("/health", (c) =>
  c.json({
    name: "portmax_api",
    status: "ok",
    upstreamConfigured: Boolean(process.env.PORTMAX_UPSTREAM_BASE_URL),
  }),
);

app.all("/mcp", async (c) => {
  const rawBladeAuth = c.req.header("x-portmax-blade-auth");
  const bladeAuth = rawBladeAuth?.trim();
  if (rawBladeAuth !== undefined && (!bladeAuth || bladeAuth.length > maxCredentialLength)) {
    return c.json({ error: "Invalid X-Portmax-Blade-Auth header." }, 400);
  }

  const tenantId = c.req.header("x-portmax-tenant-id")?.trim();
  if (tenantId && tenantId.length > maxTenantIdLength) {
    return c.json({ error: "Invalid X-Portmax-Tenant-Id header." }, 400);
  }

  const incomingCredentials = bladeAuth ? { bladeAuth, ...(tenantId ? { tenantId } : {}) } : undefined;
  const sessionId = c.req.header("mcp-session-id");

  if (sessionId) {
    const session = mcpSessions.get(sessionId);
    if (!session) {
      return c.json({ error: "Unknown MCP session." }, 404);
    }

    if (incomingCredentials) {
      if (session.credentials && session.credentials.bladeAuth !== incomingCredentials.bladeAuth) {
        return c.json({ error: "MCP session credentials cannot be changed." }, 403);
      }
      session.setCredentials(incomingCredentials);
    }

    const response = await session.transport.handleRequest(c.req.raw);
    if (c.req.method === "DELETE") {
      mcpSessions.delete(sessionId);
    }
    return response;
  }

  if (c.req.method !== "POST") {
    return c.json({ error: "MCP session initialization requires POST." }, 400);
  }

  let sessionCredentials = incomingCredentials;
  const { server, transport } = createMcpTransport({
    getSessionCredentials: () => sessionCredentials,
  });
  const session: McpSession = {
    transport,
    credentials: sessionCredentials,
    setCredentials: (credentials) => {
      sessionCredentials = credentials;
      session.credentials = credentials;
    },
  };

  await server.connect(transport);
  transport.onclose = () => {
    for (const [id, activeSession] of mcpSessions) {
      if (activeSession === session) {
        mcpSessions.delete(id);
      }
    }
  };

  const response = await transport.handleRequest(c.req.raw);
  const createdSessionId = response.headers.get("mcp-session-id");
  if (createdSessionId) {
    mcpSessions.set(createdSessionId, session);
  }
  return response;
});
app.route("/", httpRoutes);

app.notFound((c) => c.json({ error: "Not found" }, 404));
