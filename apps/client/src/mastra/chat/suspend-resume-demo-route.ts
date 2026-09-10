import { registerApiRoute } from "@mastra/core/server";
import { z } from "zod";
import {
  confirmationDecisionSchema,
  suspendAndResumeConfirmationStep,
  suspendAndResumeWarehouseSelectionStep,
  suspendResumeConfirmationStepId,
  suspendResumeWarehouseSelectionStepId,
  suspendAndResumeWorkflow,
  warehouseIdSchema,
  warehouseOptions,
} from "../workflows/suspend-and-resume-workflow.js";

const startInputSchema = z.object({
  title: z.string().trim().min(1).max(120).default("发布示例配置"),
});

const resumeInputSchema = z.discriminatedUnion("stepId", [
  z.object({
    runId: z.string().uuid(),
    stepId: z.literal(suspendResumeWarehouseSelectionStepId),
    optionValue: warehouseIdSchema,
  }),
  z.object({
    runId: z.string().uuid(),
    stepId: z.literal(suspendResumeConfirmationStepId),
    optionValue: confirmationDecisionSchema,
  }),
]);

function invalidRequest(c: any, message: string): Response {
  return c.json({ error: message }, 400);
}

/**
 * 供 Desktop 的只读三步演示面板调用。runId 仅用于恢复本次暂停的 workflow snapshot。
 */
export const suspendResumeDemoStartRoute = registerApiRoute("/desktop-demo/suspend-resume/start", {
  method: "POST",
  async handler(c) {
    const body = await c.req.json().catch(() => null);
    const parsed = startInputSchema.safeParse(body);
    if (!parsed.success) return invalidRequest(c, "演示标题格式不正确。");

    const runId = crypto.randomUUID();
    const run = await suspendAndResumeWorkflow.createRun({ runId });
    const result = await run.start({ inputData: parsed.data });
    if (result.status !== "suspended") return c.json({ error: "工作流未进入仓库选择暂停状态。" }, 500);

    return c.json({
      runId,
      status: "suspended",
      stepId: suspendResumeWarehouseSelectionStepId,
      title: parsed.data.title,
      prompt: "第 1 步（共 3 步）：请选择要处理的仓库。",
      options: warehouseOptions.map((warehouse) => ({ value: warehouse.id, label: warehouse.name })),
    });
  },
});

export const suspendResumeDemoResumeRoute = registerApiRoute("/desktop-demo/suspend-resume/resume", {
  method: "POST",
  async handler(c) {
    const body = await c.req.json().catch(() => null);
    const parsed = resumeInputSchema.safeParse(body);
    if (!parsed.success) return invalidRequest(c, "恢复参数格式不正确。" );

    const run = await suspendAndResumeWorkflow.createRun({ runId: parsed.data.runId });

    if (parsed.data.stepId === suspendResumeWarehouseSelectionStepId) {
      const warehouse = warehouseOptions.find((option) => option.id === parsed.data.optionValue);
      if (!warehouse) return invalidRequest(c, "所选仓库不存在。");

      const result = await run.resume({
        step: suspendAndResumeWarehouseSelectionStep,
        resumeData: { warehouseId: parsed.data.optionValue },
      });
      if (result.status !== "suspended") return c.json({ error: "工作流未进入确认暂停状态。" }, 409);

      return c.json({
        runId: parsed.data.runId,
        status: "suspended",
        stepId: suspendResumeConfirmationStepId,
        selectedWarehouse: warehouse,
        prompt: `第 2 步（共 3 步）：已选择“${warehouse.name}”，是否确认继续？`,
        options: [
          { value: "approve", label: "确认并继续" },
          { value: "reject", label: "取消" },
        ],
      });
    }

    const result = await run.resume({
      step: suspendAndResumeConfirmationStep,
      resumeData: { decision: parsed.data.optionValue },
    });
    if (result.status === "suspended") return c.json({ error: "工作流恢复后仍处于暂停状态。" }, 409);

    return c.json({
      runId: parsed.data.runId,
      status: "completed",
      decision: parsed.data.optionValue,
      message: "第 3 步（共 3 步）已完成。",
    });
  },
});
