import { Agent } from "@mastra/core/agent";
import { getCurrentTime } from "../tools/current-time.js";

export const portmaxAssistant = new Agent({
  id: "portmax-assistant",
  name: "Portmax",
  instructions: "You are a concise assistant for a TypeScript monorepo. Use the current-time tool when a user asks for the time.",
  model: process.env.MASTRA_MODEL ?? "openai/gpt-4.1-mini",
  tools: { getCurrentTime },
});
