import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";

const inputSchema = z.object({
  message: z.string().trim().min(1).describe("要由测试工作流回显的文本。"),
});

const outputSchema = z.object({
  message: z.string(),
});

const echoMessageStep = createStep({
  id: "mastra-smoke-workflow-echo-message",
  inputSchema,
  outputSchema,
  execute: async ({ inputData }) => ({
    message: inputData.message,
  }),
});

/**
 * 无副作用的 Workflow 冒烟测试：接收 message 并原样返回。
 * 可在 Mastra Studio 或 Workflow API 中运行，用于验证注册与执行链路。
 */
export const mastraSmokeWorkflow = createWorkflow({
  id: "mastra-smoke-workflow",
  inputSchema,
  outputSchema,
})
  .then(echoMessageStep)
  .commit();
