import { createStep, createWorkflow } from "@mastra/core/workflows";
import { z } from "zod";
import { queryWarehouseSettingsByName, type WarehouseSetting } from "./portmax-api.js";

const maxModelCandidates = 20 as const;

const portmaxRequestContextSchema = z.object({
  // Studio 可查看/编辑 Workflow 图，但不会自动继承桌面端登录会话。
  // 未认证运行会在 Step 中返回明确提示，且绝不访问上游。
  "portmax-blade-auth": z.string().trim().min(1).max(4096).optional(),
  "portmax-tenant-id": z.string().trim().min(1).max(128).optional(),
});

const warehouseCandidateSchema = z.object({
  // name 用于前端 fieldNames={{ label: "name", value: "name" }}。
  name: z.string(),
  // 仅保留选择或消歧所需的稳定标识，不传递地址、联系人、配置和审计字段给 LLM。
  id: z.string().optional(),
  warehouseId: z.string().optional(),
});

const inputSchema = z.object({
  warehouseName: z
    .string()
    .trim()
    .max(128)
    .default("")
    .describe("可选的仓库名称筛选条件；空值时查询全部仓库。"),
});

const outputSchema = z.object({
  warehouseName: z.string(),
  total: z.number().int().nonnegative().describe("本次上游响应中的匹配仓库总数。"),
  truncated: z.boolean().describe("是否因 LLM 安全摘要上限而省略了后续仓库。"),
  warehouseOptions: z.array(warehouseCandidateSchema).max(maxModelCandidates),
});

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function toWarehouseCandidate(warehouse: WarehouseSetting) {
  const id = optionalString(warehouse.id);
  const warehouseId = optionalString(warehouse.warehouseId);

  return {
    name: warehouse.name,
    ...(id ? { id } : {}),
    ...(warehouseId ? { warehouseId } : {}),
  };
}

// Workflow 在此处结束。完整上游实体仅存在于本次服务端执行内存，不会进入 LLM 或聊天记录。
const queryWarehouseName = createStep({
  id: "warehouse",
  description: "按名称查询仓库，并返回有限的安全候选摘要。",
  inputSchema,
  outputSchema,
  requestContextSchema: portmaxRequestContextSchema,
  execute: async ({ inputData, requestContext }) => {
    const bladeAuth = requestContext.get("portmax-blade-auth");
    const tenantId = requestContext.get("portmax-tenant-id");

    if (!bladeAuth) {
      throw new Error(
        "当前 Workflow 运行没有 Portmax 登录会话。请从已登录的桌面聊天入口调用 Agent；不要在 Studio 输入或粘贴 Blade-Auth。",
      );
    }

    const warehouses = await queryWarehouseSettingsByName({
      warehouseName: inputData.warehouseName,
      bladeAuth,
      ...(tenantId ? { tenantId } : {}),
    });
    const warehouseOptions = warehouses.slice(0, maxModelCandidates).map(toWarehouseCandidate);

    return {
      warehouseName: inputData.warehouseName,
      total: warehouses.length,
      truncated: warehouses.length > warehouseOptions.length,
      warehouseOptions,
    };
  },
});

/**
 * 仓库名称查询 Workflow：只向 LLM 返回有限的安全候选摘要，不创建或修改任何 Portmax 数据。
 */
export const portmaxCreateWorkflow = createWorkflow({
  id: "portmax-create-workflow",
  description: "按名称查询 Portmax 仓库，并返回有限的安全候选摘要。",
  inputSchema,
  outputSchema,
  requestContextSchema: portmaxRequestContextSchema,
})
  .then(queryWarehouseName)
  .commit();
