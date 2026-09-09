import { Mastra } from "@mastra/core/mastra";
import { MastraEditor } from "@mastra/editor";
import { MCPServer } from "@mastra/mcp";
import { portmaxAssistant } from "./agents/portmax-assistant.js";
import { portmaxChatRoute } from "./chat/portmax-chat-route.js";
import { portmaxTools } from "./mcp/client.js";
import { getCurrentTime } from "./tools/current-time.js";
import { mastraSmokeWorkflow } from "./workflows/mastra-smoke-workflow.js";
import { portmaxCreateWorkflow, portmaxTextMetricsWorkflow } from "./workflows/portmax/index.js";

const maxCredentialLength = 4096;
const maxTenantIdLength = 128;

// Register both local tools and Portmax tools discovered from 3001/mcp. This makes
// the identical tool set available through http://localhost:4111/api/mcp/local-tools/mcp.
const localToolsMcpServer = new MCPServer({
  id: "local-tools",
  name: "Portmax Tools",
  version: "0.1.0",
  tools: { getCurrentTime, ...portmaxTools },
});

async function addPortmaxRequestContext(c: any, next: () => Promise<void>, requireBladeAuth: boolean) {
  const rawBladeAuth = c.req.header("x-portmax-blade-auth");
  const bladeAuth = rawBladeAuth?.trim();
  if (rawBladeAuth !== undefined && (!bladeAuth || bladeAuth.length > maxCredentialLength)) {
    return c.json({ error: "A valid Portmax MCP credential is required." }, 401);
  }
  if (requireBladeAuth && !bladeAuth) {
    return c.json({ error: "A valid Portmax MCP credential is required." }, 401);
  }

  const tenantId = c.req.header("x-portmax-tenant-id")?.trim();
  if (tenantId && tenantId.length > maxTenantIdLength) {
    return c.json({ error: "Invalid X-Portmax-Tenant-Id header." }, 400);
  }

  const requestContext = c.get("requestContext");
  if (bladeAuth) {
    requestContext.set("portmax-blade-auth", bladeAuth);
  }
  if (tenantId) {
    requestContext.set("portmax-tenant-id", tenantId);
  }

  await next();
}

export const mastra = new Mastra({
  agents: { portmaxAssistant },
  workflows: {
    "mastra-smoke-workflow": mastraSmokeWorkflow,
    "portmax-create-workflow": portmaxCreateWorkflow,
    "portmax-text-metrics-workflow": portmaxTextMetricsWorkflow,
  },
  mcpServers: { "local-tools": localToolsMcpServer },
  editor: new MastraEditor({
    source: "code",
    codePath: "./mastra/editor",
  }),
  server: {
    cors: {
      // Electron production windows are loaded from file://; development and legacy builds use the other origins.
      origin: ["http://localhost:5173", "null", "file://"],
      allowMethods: ["*"],
      allowHeaders: ["*"],
      exposeHeaders: ["Content-Length", "X-Requested-With", "x-vercel-ai-ui-message-stream"],
    },
    middleware: [
      {
        path: "/chat/*",
        handler: (c, next) => addPortmaxRequestContext(c, next, true),
      },
      {
        // Workflow runs use the current request context to reach portmax_api. Credentials never enter workflow input/output.
        path: "/workflows/*",
        handler: (c, next) => addPortmaxRequestContext(c, next, true),
      },
      {
        // Tool discovery remains public; calls to Portmax tools can provide these
        // headers and they will be forwarded by the MCP client to portmax_api.
        path: "/mcp/*",
        handler: (c, next) => addPortmaxRequestContext(c, next, false),
      },
    ],
    apiRoutes: [portmaxChatRoute],
  },
});
