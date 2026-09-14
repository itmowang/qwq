import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  appointmentAddOnProductSelectionPayloadSchema,
  appointmentAddOnProductSelectionStepId,
  appointmentWarehouseSelectionPayloadSchema,
  appointmentWarehouseSelectionStepId,
  createAppointmentWorkflow,
  selectAppointmentAddOnProductStep,
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
  label: z.string().trim().min(1).max(400),
});
const addOnProductOptionSchema = z.object({
  value: z.string().trim().min(1).max(120),
  code: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(240),
  label: z.string().trim().min(1).max(400),
});
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
const completedInteractionSchema = z.object({
  kind: z.literal("appointment-selection-v1"),
  status: z.literal("completed"),
  runId: z.string().uuid(),
  title: requestSchema,
  warehouse: warehouseOptionSchema,
  addOnProduct: addOnProductOptionSchema,
  message: z.string(),
  completedSteps: z.literal(3),
});
const interactionOutputSchema = z.union([warehouseSuspendedInteractionSchema, addOnProductSuspendedInteractionSchema, completedInteractionSchema]);
const resumeInputSchema = z.discriminatedUnion("stepId", [
  z.object({ runId: z.string().uuid(), stepId: z.literal(appointmentWarehouseSelectionStepId), optionValue: z.string().trim().min(1).max(120), title: requestSchema }),
  z.object({ runId: z.string().uuid(), stepId: z.literal(appointmentAddOnProductSelectionStepId), optionValue: z.string().trim().min(1).max(120), title: requestSchema }),
]);

async function suspendedInteraction(runId: string) {
  const snapshot = await createAppointmentWorkflow.getWorkflowRunById(runId, { fields: ["steps"] });
  const readPayload = (stepId: string) => {
    const step = snapshot?.steps?.[stepId];
    return Array.isArray(step) ? undefined : step?.suspendPayload;
  };

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

/** 启动创建预约单的选择流程。仅收集草稿数据，不会创建或提交预约单。 */
export const startCreateAppointmentChatTool = createTool({
  id: startCreateAppointmentChatToolId,
  description: "启动创建预约单流程：分析用户请求，依次选择仓库和 Add-on Product。不会创建或提交预约单。",
  inputSchema: z.object({ request: requestSchema }),
  outputSchema: warehouseSuspendedInteractionSchema,
  execute: async ({ request }, { requestContext }) => {
    const runId = crypto.randomUUID();
    const run = await createAppointmentWorkflow.createRun({ runId });
    const result = await run.start({ inputData: { request }, requestContext: requestContext as never });
    if (result.status !== "suspended") throw new Error("创建预约单 workflow 未进入仓库选择状态。");
    const interaction = await suspendedInteraction(runId);
    if (interaction.stepId !== appointmentWarehouseSelectionStepId) {
      throw new Error("创建预约单 workflow 未暂停在仓库选择步骤。");
    }
    return interaction;
  },
});

/** 只接受桌面端预约选择标记中的受控字段，按当前暂停步骤恢复并校验候选归属。 */
export const resumeCreateAppointmentChatTool = createTool({
  id: resumeCreateAppointmentChatToolId,
  description: "恢复创建预约单流程。仅在 PORTMAX_APPOINTMENT_SELECTION_V1 选择标记出现时调用，且仅使用标记中的 runId、stepId、optionValue、title。",
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
      if (result.status !== "suspended") throw new Error("创建预约单 workflow 未进入 Add-on Product 选择状态。");
      return suspendedInteraction(input.runId);
    }

    const result = await run.resume({
      step: selectAppointmentAddOnProductStep,
      resumeData: { addOnProductValue: input.optionValue },
      requestContext: requestContext as never,
    });
    if (result.status === "suspended") throw new Error("创建预约单 workflow 恢复后仍处于 Add-on Product 选择状态。");
    if (result.status !== "success") throw new Error("创建预约单 workflow 未完成附加产品选择。");

    const completed = result.result;
    return {
      kind: "appointment-selection-v1" as const,
      status: "completed" as const,
      runId: input.runId,
      title: completed.request,
      warehouse: completed.warehouse,
      addOnProduct: completed.addOnProduct,
      message: completed.message,
      completedSteps: 3 as const,
    };
  },
});
