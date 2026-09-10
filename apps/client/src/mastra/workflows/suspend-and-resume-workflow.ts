import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";

export const suspendResumeWarehouseSelectionStepId = "suspend-and-resume-select-warehouse";
export const suspendResumeConfirmationStepId = "suspend-and-resume-confirm-selection";

export const warehouseOptions = [
  { id: "wh-shanghai", name: "上海中心仓" },
  { id: "wh-suzhou", name: "苏州保税仓" },
  { id: "wh-hangzhou", name: "杭州电商仓" },
  { id: "wh-guangzhou", name: "广州南沙仓" },
  { id: "wh-chengdu", name: "成都西南仓" },
] as const;

export const warehouseIdSchema = z.enum([
  "wh-shanghai",
  "wh-suzhou",
  "wh-hangzhou",
  "wh-guangzhou",
  "wh-chengdu",
]);
export const confirmationDecisionSchema = z.enum(["approve", "reject"]);

const warehouseSchema = z.object({
  id: warehouseIdSchema,
  name: z.string(),
});
const optionSchema = z.object({
  value: z.string(),
  label: z.string(),
});
const inputSchema = z.object({
  title: z.string().trim().min(1).max(120).describe("需要人工确认的演示事项。"),
});
const warehouseSelectionOutputSchema = z.object({
  title: z.string(),
  warehouse: warehouseSchema,
});
const confirmationOutputSchema = warehouseSelectionOutputSchema.extend({
  decision: confirmationDecisionSchema,
  message: z.string(),
});
const outputSchema = confirmationOutputSchema.extend({
  completedSteps: z.literal(3),
});

/**
 * 第一步：暂停并让用户从五个示例仓库中选择一个。
 */
export const suspendAndResumeWarehouseSelectionStep = createStep({
  id: suspendResumeWarehouseSelectionStepId,
  inputSchema,
  resumeSchema: z.object({ warehouseId: warehouseIdSchema }),
  suspendSchema: z.object({
    title: z.string(),
    prompt: z.string(),
    options: z.array(optionSchema).length(5),
  }),
  outputSchema: warehouseSelectionOutputSchema,
  execute: async ({ inputData, resumeData, suspend }) => {
    if (!resumeData?.warehouseId) {
      return suspend({
        title: inputData.title,
        prompt: "第 1 步（共 3 步）：请选择要处理的仓库。",
        options: warehouseOptions.map((warehouse) => ({ value: warehouse.id, label: warehouse.name })),
      });
    }

    const warehouse = warehouseOptions.find((option) => option.id === resumeData.warehouseId);
    if (!warehouse) throw new Error("所选仓库不存在。");
    return { title: inputData.title, warehouse };
  },
});

/**
 * 第二步：使用上一步恢复的数据再次暂停，要求用户确认选择。
 */
export const suspendAndResumeConfirmationStep = createStep({
  id: suspendResumeConfirmationStepId,
  inputSchema: warehouseSelectionOutputSchema,
  resumeSchema: z.object({ decision: confirmationDecisionSchema }),
  suspendSchema: z.object({
    title: z.string(),
    warehouse: warehouseSchema,
    prompt: z.string(),
    options: z.array(optionSchema).length(2),
  }),
  outputSchema: confirmationOutputSchema,
  execute: async ({ inputData, resumeData, suspend, suspendData }) => {
    if (!resumeData?.decision) {
      return suspend({
        title: inputData.title,
        warehouse: inputData.warehouse,
        prompt: `第 2 步（共 3 步）：已选择“${inputData.warehouse.name}”，是否确认继续？`,
        options: [
          { value: "approve", label: "确认并继续" },
          { value: "reject", label: "取消" },
        ],
      });
    }

    const warehouse = suspendData?.warehouse ?? inputData.warehouse;
    const confirmed = resumeData.decision === "approve";
    return {
      title: inputData.title,
      warehouse,
      decision: resumeData.decision,
      message: confirmed
        ? `已确认“${warehouse.name}”，继续执行最终步骤。`
        : `已取消“${warehouse.name}”的后续处理。`,
    };
  },
});

/**
 * 第三步：完成无副作用的演示结果，说明所有步骤已走完。
 */
const completeSuspendResumeDemoStep = createStep({
  id: "suspend-and-resume-complete",
  inputSchema: confirmationOutputSchema,
  outputSchema,
  execute: async ({ inputData }) => ({
    ...inputData,
    completedSteps: 3 as const,
  }),
});

/**
 * 人在回路示例：选择五个仓库之一 → 确认 → 完成。
 * 前两步会创建并恢复 Mastra workflow snapshot；整个示例没有业务副作用。
 */
export const suspendAndResumeWorkflow = createWorkflow({
  id: "suspend-and-resume-workflow",
  description: "一个三步的人在回路示例：选择仓库、确认选择并完成。",
  inputSchema,
  outputSchema,
})
  .then(suspendAndResumeWarehouseSelectionStep)
  .then(suspendAndResumeConfirmationStep)
  .then(completeSuspendResumeDemoStep)
  .commit();
