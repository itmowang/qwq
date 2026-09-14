import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  appointmentAddOnProductSelectionPayloadSchema,
  appointmentAddOnProductSelectionStepId,
  appointmentDeliveryLocationSelectionPayloadSchema,
  appointmentDeliveryLocationSelectionStepId,
  outboundTemplatePreparationPayloadSchema,
  outboundTemplatePreparationStepId,
  appointmentTaskForSelectionPayloadSchema,
  appointmentTaskForSelectionStepId,
  appointmentTypeSelectionPayloadSchema,
  appointmentTypeSelectionStepId,
  estimatedAppointmentTimeSelectionPayloadSchema,
  estimatedAppointmentTimeSelectionStepId,
  appointmentWarehouseSelectionPayloadSchema,
  appointmentWarehouseSelectionStepId,
  createAppointmentWorkflow,
  selectAppointmentAddOnProductStep,
  selectAppointmentDeliveryLocationStep,
  selectAppointmentTaskForStep,
  selectAppointmentTypeStep,
  selectEstimatedAppointmentTimeStep,
  selectAppointmentWarehouseNameStep,
} from "../workflows/portmax/create-appointment-workflow.js";

export const startCreateAppointmentChatToolId = "start-create-appointment-chat";
export const resumeCreateAppointmentChatToolId = "resume-create-appointment-chat";

const requestSchema = z.string().trim().min(1).max(4_000);
const warehouseOptionSchema = z.object({
  value: z.string().trim().min(1).max(120),
  id: z.string().trim().min(1).max(120),
  warehouseId: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(240),
  source: z.string().trim().max(240).optional(),
  natureOfOperations: z.string().trim().max(240).optional(),
  label: z.string().trim().min(1).max(400),
});
const addOnProductOptionSchema = z.object({
  value: z.string().trim().min(1).max(120),
  code: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(240),
  label: z.string().trim().min(1).max(400),
});
const deliveryLocationOptionSchema = z.object({
  value: z.string().trim().min(1).max(120), name: z.string().trim().min(1).max(240), label: z.string().trim().min(1).max(400),
});
const appointmentTypeOptionSchema = z.object({ value: z.enum(["跨境", "本土"]), name: z.enum(["跨境", "本土"]), label: z.enum(["跨境", "本土"]) });
const taskForOptionSchema = z.object({ value: z.string().trim().min(1).max(120), id: z.string().trim().min(1).max(120), globalUserCode: z.string().trim().min(1).max(120), name: z.string().trim().min(1).max(240), label: z.string().trim().min(1).max(400) });
const outboundTemplateSchema = z.object({ code: z.literal("save_outbound_template"), url: z.string().url().max(2_000) });
const estimatedAppointmentTimeSchema = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
const warehouseSuspendedInteractionSchema = z.object({
  kind: z.literal("appointment-selection-v1"),
  status: z.literal("suspended"),
  runId: z.string().uuid(),
  stepId: z.literal(appointmentWarehouseSelectionStepId),
  title: requestSchema,
  prompt: z.string().min(1),
  total: z.number().int().nonnegative(),
  truncated: z.boolean(),
  options: z.array(warehouseOptionSchema).max(100),
});
const addOnProductSuspendedInteractionSchema = z.object({
  kind: z.literal("appointment-selection-v1"),
  status: z.literal("suspended"),
  runId: z.string().uuid(),
  stepId: z.literal(appointmentAddOnProductSelectionStepId),
  title: requestSchema,
  warehouse: warehouseOptionSchema,
  prompt: z.string().min(1),
  total: z.number().int().nonnegative(),
  truncated: z.boolean(),
  options: z.array(addOnProductOptionSchema).max(100),
});
const deliveryLocationSuspendedInteractionSchema = z.object({
  kind: z.literal("appointment-selection-v1"),
  status: z.literal("suspended"),
  runId: z.string().uuid(),
  stepId: z.literal(appointmentDeliveryLocationSelectionStepId),
  title: requestSchema,
  warehouse: warehouseOptionSchema,
  addOnProduct: addOnProductOptionSchema,
  prompt: z.string().min(1),
  total: z.number().int().nonnegative(),
  truncated: z.boolean(),
  options: z.array(deliveryLocationOptionSchema).max(100),
});
const appointmentTypeSuspendedInteractionSchema = z.object({
  kind: z.literal("appointment-selection-v1"), status: z.literal("suspended"), runId: z.string().uuid(),
  stepId: z.literal(appointmentTypeSelectionStepId), title: requestSchema,
  warehouse: warehouseOptionSchema, addOnProduct: addOnProductOptionSchema, deliveryLocation: deliveryLocationOptionSchema,
  prompt: z.string().min(1), total: z.number().int().nonnegative(), truncated: z.boolean(), options: z.array(appointmentTypeOptionSchema).length(2),
});
const estimatedAppointmentTimeSuspendedInteractionSchema = z.object({ kind: z.literal("appointment-selection-v1"), status: z.literal("suspended"), runId: z.string().uuid(), stepId: z.literal(estimatedAppointmentTimeSelectionStepId), title: requestSchema, warehouse: warehouseOptionSchema, addOnProduct: addOnProductOptionSchema, deliveryLocation: deliveryLocationOptionSchema, appointmentType: appointmentTypeOptionSchema, prompt: z.string().min(1) });
const taskForSuspendedInteractionSchema = z.object({ kind: z.literal("appointment-selection-v1"), status: z.literal("suspended"), runId: z.string().uuid(), stepId: z.literal(appointmentTaskForSelectionStepId), title: requestSchema, warehouse: warehouseOptionSchema, addOnProduct: addOnProductOptionSchema, deliveryLocation: deliveryLocationOptionSchema, appointmentType: appointmentTypeOptionSchema, estimatedAppointmentTime: estimatedAppointmentTimeSchema, prompt: z.string().min(1), total: z.number().int().nonnegative(), truncated: z.boolean(), options: z.array(taskForOptionSchema).max(100) });
const outboundTemplatePreparationSuspendedInteractionSchema = z.object({ kind: z.literal("appointment-selection-v1"), status: z.literal("suspended"), runId: z.string().uuid(), stepId: z.literal(outboundTemplatePreparationStepId), title: requestSchema, warehouse: warehouseOptionSchema, addOnProduct: addOnProductOptionSchema, deliveryLocation: deliveryLocationOptionSchema, appointmentType: appointmentTypeOptionSchema, estimatedAppointmentTime: estimatedAppointmentTimeSchema, taskFor: taskForOptionSchema, template: outboundTemplateSchema, prompt: z.string().min(1) });
const interactionOutputSchema = z.union([
  warehouseSuspendedInteractionSchema,
  addOnProductSuspendedInteractionSchema,
  deliveryLocationSuspendedInteractionSchema,
  appointmentTypeSuspendedInteractionSchema,
  estimatedAppointmentTimeSuspendedInteractionSchema,
  taskForSuspendedInteractionSchema,
  outboundTemplatePreparationSuspendedInteractionSchema,
]);
const resumeInputSchema = z.discriminatedUnion("stepId", [
  z.object({ runId: z.string().uuid(), stepId: z.literal(appointmentWarehouseSelectionStepId), optionValue: z.string().trim().min(1).max(120), title: requestSchema }),
  z.object({ runId: z.string().uuid(), stepId: z.literal(appointmentAddOnProductSelectionStepId), optionValue: z.string().trim().min(1).max(120), title: requestSchema }),
  z.object({ runId: z.string().uuid(), stepId: z.literal(appointmentDeliveryLocationSelectionStepId), optionValue: z.string().trim().min(1).max(120), title: requestSchema }),
  z.object({ runId: z.string().uuid(), stepId: z.literal(appointmentTypeSelectionStepId), optionValue: z.enum(["跨境", "本土"]), title: requestSchema }),
  z.object({ runId: z.string().uuid(), stepId: z.literal(estimatedAppointmentTimeSelectionStepId), optionValue: estimatedAppointmentTimeSchema, title: requestSchema }),
  z.object({ runId: z.string().uuid(), stepId: z.literal(appointmentTaskForSelectionStepId), optionValue: z.string().trim().min(1).max(120), title: requestSchema }),
]);

async function suspendedInteraction(runId: string) {
  const snapshot = await createAppointmentWorkflow.getWorkflowRunById(runId, { fields: ["steps"] });
  const readPayload = (stepId: string) => {
    const step = snapshot?.steps?.[stepId];
    return Array.isArray(step) ? undefined : step?.suspendPayload;
  };

  const outboundTemplate = outboundTemplatePreparationPayloadSchema.safeParse(readPayload(outboundTemplatePreparationStepId));
  if (outboundTemplate.success) return { kind: "appointment-selection-v1" as const, status: "suspended" as const, runId, stepId: outboundTemplatePreparationStepId as typeof outboundTemplatePreparationStepId, title: outboundTemplate.data.request, warehouse: outboundTemplate.data.warehouse, addOnProduct: outboundTemplate.data.addOnProduct, deliveryLocation: outboundTemplate.data.deliveryLocation, appointmentType: outboundTemplate.data.appointmentType, estimatedAppointmentTime: outboundTemplate.data.estimatedAppointmentTime, taskFor: outboundTemplate.data.taskFor, template: outboundTemplate.data.template, prompt: outboundTemplate.data.prompt };

  const taskFor = appointmentTaskForSelectionPayloadSchema.safeParse(readPayload(appointmentTaskForSelectionStepId));
  if (taskFor.success) return { kind: "appointment-selection-v1" as const, status: "suspended" as const, runId, stepId: appointmentTaskForSelectionStepId as typeof appointmentTaskForSelectionStepId, title: taskFor.data.request, warehouse: taskFor.data.warehouse, addOnProduct: taskFor.data.addOnProduct, deliveryLocation: taskFor.data.deliveryLocation, appointmentType: taskFor.data.appointmentType, estimatedAppointmentTime: taskFor.data.estimatedAppointmentTime, prompt: taskFor.data.prompt, total: taskFor.data.total, truncated: taskFor.data.truncated, options: taskFor.data.options };

  const estimatedTime = estimatedAppointmentTimeSelectionPayloadSchema.safeParse(readPayload(estimatedAppointmentTimeSelectionStepId));
  if (estimatedTime.success) return { kind: "appointment-selection-v1" as const, status: "suspended" as const, runId, stepId: estimatedAppointmentTimeSelectionStepId as typeof estimatedAppointmentTimeSelectionStepId, title: estimatedTime.data.request, warehouse: estimatedTime.data.warehouse, addOnProduct: estimatedTime.data.addOnProduct, deliveryLocation: estimatedTime.data.deliveryLocation, appointmentType: estimatedTime.data.appointmentType, prompt: estimatedTime.data.prompt };

  const appointmentType = appointmentTypeSelectionPayloadSchema.safeParse(readPayload(appointmentTypeSelectionStepId));
  if (appointmentType.success) return { kind: "appointment-selection-v1" as const, status: "suspended" as const, runId, stepId: appointmentTypeSelectionStepId as typeof appointmentTypeSelectionStepId, title: appointmentType.data.request, warehouse: appointmentType.data.warehouse, addOnProduct: appointmentType.data.addOnProduct, deliveryLocation: appointmentType.data.deliveryLocation, prompt: appointmentType.data.prompt, total: appointmentType.data.total, truncated: appointmentType.data.truncated, options: appointmentType.data.options };

  const deliveryLocation = appointmentDeliveryLocationSelectionPayloadSchema.safeParse(readPayload(appointmentDeliveryLocationSelectionStepId));
  if (deliveryLocation.success) {
    return {
      kind: "appointment-selection-v1" as const,
      status: "suspended" as const,
      runId,
      stepId: appointmentDeliveryLocationSelectionStepId as typeof appointmentDeliveryLocationSelectionStepId,
      title: deliveryLocation.data.request,
      warehouse: deliveryLocation.data.warehouse,
      addOnProduct: deliveryLocation.data.addOnProduct,
      prompt: deliveryLocation.data.prompt,
      total: deliveryLocation.data.total,
      truncated: deliveryLocation.data.truncated,
      options: deliveryLocation.data.options,
    };
  }

  const addOnProduct = appointmentAddOnProductSelectionPayloadSchema.safeParse(readPayload(appointmentAddOnProductSelectionStepId));
  if (addOnProduct.success) {
    return {
      kind: "appointment-selection-v1" as const,
      status: "suspended" as const,
      runId,
      stepId: appointmentAddOnProductSelectionStepId as typeof appointmentAddOnProductSelectionStepId,
      title: addOnProduct.data.request,
      warehouse: addOnProduct.data.warehouse,
      prompt: addOnProduct.data.prompt,
      total: addOnProduct.data.total,
      truncated: addOnProduct.data.truncated,
      options: addOnProduct.data.options,
    };
  }

  const warehouse = appointmentWarehouseSelectionPayloadSchema.safeParse(readPayload(appointmentWarehouseSelectionStepId));
  if (warehouse.success) {
    return {
      kind: "appointment-selection-v1" as const,
      status: "suspended" as const,
      runId,
      stepId: appointmentWarehouseSelectionStepId as typeof appointmentWarehouseSelectionStepId,
      title: warehouse.data.request,
      prompt: warehouse.data.prompt,
      total: warehouse.data.total,
      truncated: warehouse.data.truncated,
      options: warehouse.data.options,
    };
  }

  throw new Error("创建预约单 workflow 的选择数据无效。");
}

function workflowFailureMessage(result: unknown, fallback: string): string {
  const errorMessage = (value: unknown): string | undefined => {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (value instanceof Error && value.message.trim()) return value.message.trim();
    if (typeof value !== "object" || value === null) return undefined;
    const record = value as Record<string, unknown>;
    return errorMessage(record.message) ?? errorMessage(record.error) ?? errorMessage(record.cause);
  };
  const detail = errorMessage(result);
  return detail ? `${fallback}：${detail.slice(0, 500)}` : fallback;
}

/** 启动创建预约单流程。完整请求中已提供且可在受控候选中唯一匹配的字段会直接写入草稿；仅缺失、无效或歧义字段才等待选择。 */
export const startCreateAppointmentChatTool = createTool({
  id: startCreateAppointmentChatToolId,
  description: "启动创建预约单流程：先确定性解析完整请求，再从受控候选唯一匹配仓库、Add-on Product、Delivery Location、预约类型、预计时间与 Task For；仅缺失、无效或歧义字段才要求选择。不会创建或提交预约单。",
  inputSchema: z.object({ request: requestSchema }),
  outputSchema: interactionOutputSchema,
  execute: async ({ request }, { requestContext }) => {
    const runId = crypto.randomUUID();
    const run = await createAppointmentWorkflow.createRun({ runId });
    const result = await run.start({ inputData: { request }, requestContext: requestContext as never });
    if (result.status === "suspended") return suspendedInteraction(runId);
    if (result.status === "success") throw new Error("创建预约单草稿流程意外结束，未进入附件准备状态。请重新开始。");
    throw new Error(workflowFailureMessage(result, "创建预约单 workflow 未能完成或进入有效的选择状态。"));
  },
});

/** 只接受桌面端预约选择标记中的受控字段，按当前暂停步骤恢复并校验候选归属。 */
export const resumeCreateAppointmentChatTool = createTool({
  id: resumeCreateAppointmentChatToolId,
  description: "恢复创建预约单流程。仅处理 PORTMAX_APPOINTMENT_SELECTION_V1 中六个仓库/产品/地点/类型/时间/Task For 选择步骤；附件准备完全由桌面 Save 卡片本地处理，不可恢复。",
  inputSchema: resumeInputSchema,
  outputSchema: interactionOutputSchema,
  execute: async (input, { requestContext }) => {
    const run = await createAppointmentWorkflow.createRun({ runId: input.runId });
    if (input.stepId === appointmentWarehouseSelectionStepId) {
      const result = await run.resume({
        step: selectAppointmentWarehouseNameStep,
        resumeData: { warehouseValue: input.optionValue },
        requestContext: requestContext as never,
      });
      if (result.status === "suspended") return suspendedInteraction(input.runId);
      if (result.status === "success") throw new Error("创建预约单草稿流程意外结束，未进入附件准备状态。请重新开始。");
      throw new Error("创建预约单 workflow 恢复后未能完成或进入有效的选择状态。");
    }

    if (input.stepId === appointmentAddOnProductSelectionStepId) {
      const result = await run.resume({
        step: selectAppointmentAddOnProductStep,
        resumeData: { addOnProductValue: input.optionValue },
        requestContext: requestContext as never,
      });
      if (result.status === "suspended") return suspendedInteraction(input.runId);
      if (result.status === "success") throw new Error("创建预约单草稿流程意外结束，未进入附件准备状态。请重新开始。");
      throw new Error(workflowFailureMessage(result, "创建预约单 workflow 恢复后未能进入 Delivery Location 选择状态。"));
    }

    if (input.stepId === appointmentDeliveryLocationSelectionStepId) {
      const result = await run.resume({ step: selectAppointmentDeliveryLocationStep, resumeData: { deliveryLocationValue: input.optionValue }, requestContext: requestContext as never });
      if (result.status === "suspended") return suspendedInteraction(input.runId);
      if (result.status === "success") throw new Error("创建预约单草稿流程意外结束，未进入附件准备状态。请重新开始。");
      throw new Error(workflowFailureMessage(result, "创建预约单 workflow 恢复后未能进入预约单类型选择状态。"));
    }

    if (input.stepId === appointmentTypeSelectionStepId) {
      const result = await run.resume({ step: selectAppointmentTypeStep, resumeData: { appointmentTypeValue: input.optionValue }, requestContext: requestContext as never });
      if (result.status === "suspended") return suspendedInteraction(input.runId);
      if (result.status === "success") throw new Error("创建预约单草稿流程意外结束，未进入附件准备状态。请重新开始。");
      throw new Error(workflowFailureMessage(result, "创建预约单 workflow 恢复后未能进入 Estimated Appointment Time 选择状态。"));
    }
    if (input.stepId === estimatedAppointmentTimeSelectionStepId) {
      const result = await run.resume({ step: selectEstimatedAppointmentTimeStep, resumeData: { estimatedAppointmentTime: input.optionValue }, requestContext: requestContext as never });
      if (result.status === "suspended") return suspendedInteraction(input.runId);
      if (result.status === "success") throw new Error("创建预约单草稿流程意外结束，未进入附件准备状态。请重新开始。");
      throw new Error(workflowFailureMessage(result, "创建预约单 workflow 恢复后未能进入 Task For 选择状态。"));
    }

    if (input.stepId === appointmentTaskForSelectionStepId) {
      const result = await run.resume({ step: selectAppointmentTaskForStep, resumeData: { taskForValue: input.optionValue }, requestContext: requestContext as never });
      if (result.status === "suspended") return suspendedInteraction(input.runId);
      if (result.status === "success") throw new Error("创建预约单草稿流程意外结束，未进入附件准备状态。请重新开始。");
      throw new Error(workflowFailureMessage(result, "创建预约单 workflow 恢复后未能进入附件模板准备步骤。"));
    }

    throw new Error("附件准备在桌面卡片中本地完成；请选择 Excel 文件后直接点击 Save，不要恢复 workflow。");
  },
});
