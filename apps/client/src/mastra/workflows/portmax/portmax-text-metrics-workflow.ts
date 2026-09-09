import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";

const inputSchema = z.object({
  text: z.string().trim().min(1).describe("要统计的非空文本。"),
});

const outputSchema = z.object({
  normalizedText: z.string(),
  characterCount: z.number().int().nonnegative(),
  wordCount: z.number().int().nonnegative(),
});

const analyzeTextStep = createStep({
  id: "portmax-text-metrics-workflow-analyze-text",
  inputSchema,
  outputSchema,
  execute: async ({ inputData }) => {
    const normalizedText = inputData.text;

    return {
      normalizedText,
      characterCount: Array.from(normalizedText).length,
      wordCount: normalizedText.split(/\s+/).length,
    };
  },
});

/**
 * 文本统计示例：演示纯计算型 Workflow 的输入、步骤与结构化输出。
 */
export const portmaxTextMetricsWorkflow = createWorkflow({
  id: "portmax-text-metrics-workflow",
  inputSchema,
  outputSchema,
})
  .then(analyzeTextStep)
  .commit();
