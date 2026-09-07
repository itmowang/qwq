import { Agent } from "@mastra/core/agent";
import { portmaxTools } from "../mcp/client.js";
import { getCurrentTime } from "../tools/current-time.js";

export const portmaxAssistant = new Agent({
  id: "portmax-assistant",
  name: "Portmax",
  instructions:
    "You are a concise Portmax assistant. Use the current-time tool when a user asks for the time. Use portmax_get_outbound_schedule_page for outbound schedule queries. Use portmax_request_upstream only when the user explicitly needs another configured Portmax upstream API endpoint.",
  // model: process.env.MASTRA_MODEL ?? "openai/gpt-4.1-mini",
  model: "alibaba-token-plan-cn/qwen3.8-max",
  tools: { getCurrentTime, ...portmaxTools },
});
