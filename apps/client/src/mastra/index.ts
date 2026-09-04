import { chatRoute } from "@mastra/ai-sdk";
import { Mastra } from "@mastra/core/mastra";
import { MastraEditor } from "@mastra/editor";
import { portmaxAssistant } from "./agents/portmax-assistant.js";

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
    apiRoutes: [chatRoute({ path: "/chat/:agentId" })],
  },
});
