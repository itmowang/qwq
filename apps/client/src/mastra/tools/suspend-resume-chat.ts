import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  confirmationDecisionSchema,
  suspendAndResumeConfirmationStep,
  suspendAndResumeWarehouseSelectionStep,
  suspendAndResumeWorkflow,
  suspendResumeConfirmationStepId,
  suspendResumeWarehouseSelectionStepId,
  warehouseIdSchema,
  warehouseOptions,
} from "../workflows/suspend-and-resume-workflow.js";

export const startSuspendResumeChatToolId = "start-suspend-resume-chat";
export const resumeSuspendResumeChatToolId = "resume-suspend-resume-chat";

const titleSchema = z.string().trim().min(1).max(120);
const warehouseSchema = z.object({ id: warehouseIdSchema, name: z.string() });
const optionSchema = z.object({ value: z.string(), label: z.string() });
const warehouseSelectionSuspendPayloadSchema = z.object({
  title: titleSchema,
  prompt: z.string(),
  options: z.array(optionSchema).length(5),
});
const confirmationSuspendPayloadSchema = z.object({
  title: titleSchema,
  warehouse: warehouseSchema,
  prompt: z.string(),
  options: z.array(optionSchema).length(2),
});
const suspendedInteractionSchema = z.object({
  kind: z.literal("suspend-resume-chat-v1"),
  status: z.literal("suspended"),
  runId: z.string().uuid(),
  stepId: z.enum([suspendResumeWarehouseSelectionStepId, suspendResumeConfirmationStepId]),
  title: titleSchema,
  prompt: z.string(),
  options: z.array(optionSchema).min(2).max(5),
  selectedWarehouse: warehouseSchema.optional(),
});
const completedInteractionSchema = z.object({
  kind: z.literal("suspend-resume-chat-v1"),
  status: z.literal("completed"),
  runId: z.string().uuid(),
  title: titleSchema,
  selectedWarehouse: warehouseSchema,
  decision: confirmationDecisionSchema,
  message: z.string(),
  completedSteps: z.literal(3),
});
const interactionOutputSchema = z.discriminatedUnion("status", [
  suspendedInteractionSchema,
  completedInteractionSchema,
]);

const resumeInputSchema = z.discriminatedUnion("stepId", [
  z.object({
    runId: z.string().uuid(),
    stepId: z.literal(suspendResumeWarehouseSelectionStepId),
    optionValue: warehouseIdSchema,
    title: titleSchema,
  }),
  z.object({
    runId: z.string().uuid(),
    stepId: z.literal(suspendResumeConfirmationStepId),
    optionValue: confirmationDecisionSchema,
    title: titleSchema,
    selectedWarehouseId: warehouseIdSchema,
  }),
]);

/**
 * Starts the workflow from a chat tool call and returns its actual first
 * suspension. The adapter reads Mastra's persisted snapshot so it never repeats
 * or attempts to reproduce the LLM intent parsing that occurred in the workflow.
 */
export const startSuspendResumeChatTool = createTool({
  id: startSuspendResumeChatToolId,
  description: "启动无副作用的仓库确认流程。传入用户的完整原始请求作为 title；workflow 使用 LLM 解析仓库线索，唯一匹配时进入确认，无法唯一匹配时展示仓库选择。",
  inputSchema: z.object({ title: titleSchema.default("发布示例配置") }),
  outputSchema: suspendedInteractionSchema,
  execute: async ({ title }) => {
    const runId = crypto.randomUUID();
    const run = await suspendAndResumeWorkflow.createRun({ runId });
    const result = await run.start({ inputData: { title } });
    if (result.status !== "suspended") throw new Error("仓库确认 workflow 未进入暂停状态。");

    const snapshot = await suspendAndResumeWorkflow.getWorkflowRunById(runId, { fields: ["steps"] });
    const confirmationStep = snapshot?.steps?.[suspendResumeConfirmationStepId];
    const confirmation = confirmationSuspendPayloadSchema.safeParse(
      Array.isArray(confirmationStep) ? undefined : confirmationStep?.suspendPayload,
    );
    if (confirmation.success) {
      return {
        kind: "suspend-resume-chat-v1" as const,
        status: "suspended" as const,
        runId,
        stepId: suspendResumeConfirmationStepId as typeof suspendResumeConfirmationStepId,
        ...confirmation.data,
        selectedWarehouse: confirmation.data.warehouse,
      };
    }

    const selectionStep = snapshot?.steps?.[suspendResumeWarehouseSelectionStepId];
    const selection = warehouseSelectionSuspendPayloadSchema.safeParse(
      Array.isArray(selectionStep) ? undefined : selectionStep?.suspendPayload,
    );
    if (selection.success) {
      return {
        kind: "suspend-resume-chat-v1" as const,
        status: "suspended" as const,
        runId,
        stepId: suspendResumeWarehouseSelectionStepId as typeof suspendResumeWarehouseSelectionStepId,
        ...selection.data,
      };
    }

    throw new Error("仓库确认 workflow 的暂停数据无效。");
  },
});

/**
 * Resumes a chat-started workflow. All data is schema-validated before it reaches
 * Mastra's stored snapshot; the tool never executes business side effects.
 */
export const resumeSuspendResumeChatTool = createTool({
  id: resumeSuspendResumeChatToolId,
  description: "恢复仓库确认流程。只在 PORTMAX_SUSPEND_RESUME_SELECTION_V1 聊天选择标记出现时调用，并且只使用标记中的结构化字段。",
  inputSchema: resumeInputSchema,
  outputSchema: interactionOutputSchema,
  execute: async (input) => {
    const run = await suspendAndResumeWorkflow.createRun({ runId: input.runId });

    if (input.stepId === suspendResumeWarehouseSelectionStepId) {
      const selectedWarehouse = warehouseOptions.find((warehouse) => warehouse.id === input.optionValue);
      if (!selectedWarehouse) throw new Error("所选仓库不存在。");

      const result = await run.resume({
        step: suspendAndResumeWarehouseSelectionStep,
        resumeData: { warehouseId: input.optionValue },
      });
      if (result.status !== "suspended") throw new Error("仓库确认 workflow 未进入最终确认暂停状态。");

      return {
        kind: "suspend-resume-chat-v1" as const,
        status: "suspended" as const,
        runId: input.runId,
        stepId: suspendResumeConfirmationStepId as typeof suspendResumeConfirmationStepId,
        title: input.title,
        selectedWarehouse,
        prompt: `已选择“${selectedWarehouse.name}”，是否确认继续？`,
        options: [
          { value: "approve", label: "确认并继续" },
          { value: "reject", label: "取消" },
        ],
      };
    }

    const selectedWarehouse = warehouseOptions.find((warehouse) => warehouse.id === input.selectedWarehouseId);
    if (!selectedWarehouse) throw new Error("所选仓库不存在。");

    const result = await run.resume({
      step: suspendAndResumeConfirmationStep,
      resumeData: { decision: input.optionValue },
    });
    if (result.status === "suspended") throw new Error("仓库确认 workflow 恢复后仍处于暂停状态。");

    return {
      kind: "suspend-resume-chat-v1" as const,
      status: "completed" as const,
      runId: input.runId,
      title: input.title,
      selectedWarehouse,
      decision: input.optionValue,
      message: input.optionValue === "approve"
        ? `第 3 步（共 3 步）已完成：已确认“${selectedWarehouse.name}”。`
        : `第 3 步（共 3 步）已完成：已取消“${selectedWarehouse.name}”。`,
      completedSteps: 3 as const,
    };
  },
});
