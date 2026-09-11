import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  confirmationDecisionSchema, deliveryAddressIdSchema, deliveryAddressOptions,
  suspendAndResumeConfirmationStep, suspendAndResumeDeliveryAddressSelectionStep, suspendAndResumeWarehouseSelectionStep, suspendAndResumeWorkflow,
  suspendResumeConfirmationStepId, suspendResumeDeliveryAddressSelectionStepId, suspendResumeWarehouseSelectionStepId,
  warehouseIdSchema,
} from "../workflows/suspend-and-resume-workflow.js";

export const startSuspendResumeChatToolId = "start-suspend-resume-chat";
export const resumeSuspendResumeChatToolId = "resume-suspend-resume-chat";
const titleSchema = z.string().trim().min(1).max(120);
const warehouseSchema = z.object({ id: warehouseIdSchema, name: z.string() });
const deliveryAddressSchema = z.object({ id: deliveryAddressIdSchema, name: z.string(), address: z.string() });
const optionSchema = z.object({ value: z.string(), label: z.string() });
const warehousePayloadSchema = z.object({ title: titleSchema, prompt: z.string(), options: z.array(optionSchema).length(5) });
const addressPayloadSchema = z.object({ title: titleSchema, warehouse: warehouseSchema, prompt: z.string(), options: z.array(optionSchema).length(3), deliveryAddresses: z.array(deliveryAddressSchema).length(3) });
const confirmationPayloadSchema = z.object({ title: titleSchema, warehouse: warehouseSchema, deliveryAddress: deliveryAddressSchema, prompt: z.string(), options: z.array(optionSchema).length(2) });
const suspendedInteractionSchema = z.object({
  kind: z.literal("suspend-resume-chat-v1"), status: z.literal("suspended"), runId: z.string().uuid(),
  stepId: z.enum([suspendResumeWarehouseSelectionStepId, suspendResumeDeliveryAddressSelectionStepId, suspendResumeConfirmationStepId]),
  title: titleSchema, prompt: z.string(), options: z.array(optionSchema).min(2).max(5),
  selectedWarehouse: warehouseSchema.optional(), selectedDeliveryAddress: deliveryAddressSchema.optional(),
});
const completedInteractionSchema = z.object({
  kind: z.literal("suspend-resume-chat-v1"), status: z.literal("completed"), runId: z.string().uuid(), title: titleSchema,
  selectedWarehouse: warehouseSchema, selectedDeliveryAddress: deliveryAddressSchema, decision: confirmationDecisionSchema, message: z.string(), completedSteps: z.literal(4),
});
const interactionOutputSchema = z.discriminatedUnion("status", [suspendedInteractionSchema, completedInteractionSchema]);
const resumeInputSchema = z.discriminatedUnion("stepId", [
  z.object({ runId: z.string().uuid(), stepId: z.literal(suspendResumeWarehouseSelectionStepId), optionValue: warehouseIdSchema, title: titleSchema }),
  z.object({ runId: z.string().uuid(), stepId: z.literal(suspendResumeDeliveryAddressSelectionStepId), optionValue: deliveryAddressIdSchema, title: titleSchema }),
  z.object({ runId: z.string().uuid(), stepId: z.literal(suspendResumeConfirmationStepId), optionValue: confirmationDecisionSchema, title: titleSchema }),
]);

async function suspendedInteraction(runId: string) {
  const snapshot = await suspendAndResumeWorkflow.getWorkflowRunById(runId, { fields: ["steps"] });
  const readPayload = (stepId: string) => {
    const step = snapshot?.steps?.[stepId];
    return Array.isArray(step) ? undefined : step?.suspendPayload;
  };
  const confirmation = confirmationPayloadSchema.safeParse(readPayload(suspendResumeConfirmationStepId));
  if (confirmation.success) return { kind: "suspend-resume-chat-v1" as const, status: "suspended" as const, runId, stepId: suspendResumeConfirmationStepId as typeof suspendResumeConfirmationStepId, ...confirmation.data, selectedWarehouse: confirmation.data.warehouse, selectedDeliveryAddress: confirmation.data.deliveryAddress };
  const address = addressPayloadSchema.safeParse(readPayload(suspendResumeDeliveryAddressSelectionStepId));
  if (address.success) return { kind: "suspend-resume-chat-v1" as const, status: "suspended" as const, runId, stepId: suspendResumeDeliveryAddressSelectionStepId as typeof suspendResumeDeliveryAddressSelectionStepId, ...address.data, selectedWarehouse: address.data.warehouse };
  const warehouse = warehousePayloadSchema.safeParse(readPayload(suspendResumeWarehouseSelectionStepId));
  if (warehouse.success) return { kind: "suspend-resume-chat-v1" as const, status: "suspended" as const, runId, stepId: suspendResumeWarehouseSelectionStepId as typeof suspendResumeWarehouseSelectionStepId, ...warehouse.data };
  throw new Error("仓库派送 workflow 的暂停数据无效。");
}

export const startSuspendResumeChatTool = createTool({
  id: startSuspendResumeChatToolId,
  description: "启动无副作用的仓库派送确认流程。workflow 使用 LLM 解析仓库和目标地址线索，用户仍必须选择派送地址并最终确认。",
  inputSchema: z.object({ title: titleSchema.default("发布示例配置") }), outputSchema: suspendedInteractionSchema,
  execute: async ({ title }) => {
    const runId = crypto.randomUUID();
    const run = await suspendAndResumeWorkflow.createRun({ runId });
    const result = await run.start({ inputData: { title } });
    if (result.status !== "suspended") throw new Error("仓库派送 workflow 未进入暂停状态。");
    return suspendedInteraction(runId);
  },
});

export const resumeSuspendResumeChatTool = createTool({
  id: resumeSuspendResumeChatToolId,
  description: "恢复仓库派送确认流程。只在 PORTMAX_SUSPEND_RESUME_SELECTION_V1 聊天选择标记出现时调用，并且只使用标记中的 runId、stepId、optionValue 和 title。",
  inputSchema: resumeInputSchema, outputSchema: interactionOutputSchema,
  execute: async (input) => {
    const run = await suspendAndResumeWorkflow.createRun({ runId: input.runId });
    if (input.stepId === suspendResumeWarehouseSelectionStepId) {
      const result = await run.resume({ step: suspendAndResumeWarehouseSelectionStep, resumeData: { warehouseId: input.optionValue } });
      if (result.status !== "suspended") throw new Error("仓库派送 workflow 未进入地址选择暂停状态。");
      return suspendedInteraction(input.runId);
    }
    if (input.stepId === suspendResumeDeliveryAddressSelectionStepId) {
      const result = await run.resume({ step: suspendAndResumeDeliveryAddressSelectionStep, resumeData: { deliveryAddressId: input.optionValue } });
      if (result.status !== "suspended") throw new Error("仓库派送 workflow 未进入最终确认暂停状态。");
      return suspendedInteraction(input.runId);
    }
    const result = await run.resume({ step: suspendAndResumeConfirmationStep, resumeData: { decision: input.optionValue } });
    if (result.status === "suspended") throw new Error("仓库派送 workflow 恢复后仍处于暂停状态。");
    if (result.status !== "success") throw new Error("仓库派送 workflow 未完成。");
    const completed = result.result;
    return { kind: "suspend-resume-chat-v1" as const, status: "completed" as const, runId: input.runId, title: completed.title, selectedWarehouse: completed.warehouse, selectedDeliveryAddress: completed.deliveryAddress, decision: completed.decision, message: completed.message, completedSteps: 4 as const };
  },
});
