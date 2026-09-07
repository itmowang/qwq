import { chatRoute } from "@mastra/ai-sdk";
import { Mastra } from "@mastra/core/mastra";
import { MastraEditor } from "@mastra/editor";
import { portmaxAssistant } from "./agents/portmax-assistant.js";

const maxCredentialLength = 4096;

export const mastra = new Mastra({
  agents: { portmaxAssistant },
  editor: new MastraEditor({
    source: "code",
    codePath: "./mastra/editor",
  }),
  server: {
    cors: {
      origin: ["http://localhost:5173", "null"],
      allowMethods: ["*"],
      allowHeaders: ["*"],
    },
    middleware: [
      {
        path: "/chat/*",
        handler: async (c, next) => {
          const bladeAuth = c.req.header("x-portmax-blade-auth")?.trim();
          if (!bladeAuth || bladeAuth.length > maxCredentialLength) {
            return c.json({ error: "A valid Portmax MCP credential is required." }, 401);
          }

          const requestContext = c.get("requestContext");
          requestContext.set("portmax-blade-auth", bladeAuth);
          const tenantId = c.req.header("x-portmax-tenant-id")?.trim();
          if (tenantId && tenantId.length <= 128) {
            requestContext.set("portmax-tenant-id", tenantId);
          }

          await next();
        },
      },
    ],
    apiRoutes: [chatRoute({ path: "/chat/:agentId" })],
  },
});
