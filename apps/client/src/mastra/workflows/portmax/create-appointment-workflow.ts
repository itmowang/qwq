import { createStep, createWorkflow } from "@mastra/core/workflows";
import { mcpClient, portmaxTools } from "../../mcp/client.js";
import { z } from "zod";

const maxWarehouseOptions = 100 as const;
const maxAddOnProductOptions = 100 as const;
const maxDeliveryLocationOptions = 100 as const;
const maxAppointmentTypeOptions = 2 as const;
const maxTaskForOptions = 100 as const;

export const appointmentWarehouseSelectionStepId = "create-appointment-select-warehouse-name";
export const appointmentAddOnProductSelectionStepId = "create-appointment-select-add-on-product";
export const appointmentDeliveryLocationSelectionStepId = "create-appointment-select-delivery-location";
export const appointmentTypeSelectionStepId = "create-appointment-select-appointment-type";
export const estimatedAppointmentTimeSelectionStepId = "create-appointment-select-estimated-appointment-time";
export const appointmentTaskForSelectionStepId = "create-appointment-select-task-for";
export const outboundTemplatePreparationStepId = "create-appointment-prepare-attachment";

const portmaxRequestContextSchema = z.object({
  "portmax-blade-auth": z.string().trim().min(1).max(4096).optional(),
  "portmax-tenant-id": z.string().trim().min(1).max(128).optional(),
});

const appointmentIntentSchema = z.object({
  operation: z.enum(["create-appointment", "other"]),
  warehouseNameHint: z.string().trim().min(1).max(120).nullable(),
  extractedData: z.array(z.object({ field: z.string().max(60), value: z.string().max(240) })).max(20),
  missingData: z.array(z.string().max(60)).max(20),
});

const inputSchema = z.object({
  request: z.string().trim().min(1).max(4_000).describe("用户关于创建预约单的原始请求。"),
});

const analyzedInputSchema = inputSchema.extend({
  intent: appointmentIntentSchema,
  dataFetchPlan: z.literal("warehouse-settings"),
});

export const appointmentWarehouseOptionSchema = z.object({
  value: z.string().trim().min(1).max(120).describe("仓库设置的稳定 ID，仅用于恢复本次选择。"),
  id: z.string().trim().min(1).max(120).describe("Portmax 仓库设置 ID。"),
  warehouseId: z.string().trim().min(1).max(120).describe("Portmax 仓库编码。"),
  name: z.string().trim().min(1).max(240).describe("仓库名称。"),
  source: z.string().trim().max(240).optional().describe("仓库设置返回的预约来源。"),
  natureOfOperations: z.string().trim().max(240).optional().describe("仓库设置返回的操作性质，source 缺失时用于保存。"),
  label: z.string().trim().min(1).max(400).describe("展示给用户选择的仓库名称和编码。"),
});

export const appointmentAddOnProductOptionSchema = z.object({
  value: z.string().trim().min(1).max(120).describe("附加产品编码，仅用于恢复本次选择。"),
  code: z.string().trim().min(1).max(120).describe("Portmax 附加产品编码。"),
  name: z.string().trim().min(1).max(240).describe("附加产品名称。"),
  label: z.string().trim().min(1).max(400).describe("展示给用户选择的附加产品名称和编码。"),
});

export const appointmentDeliveryLocationOptionSchema = z.object({
  value: z.string().trim().min(1).max(120).describe("Delivery Location字典的稳定键，仅用于恢复本次选择。"),
  name: z.string().trim().min(1).max(240).describe("Delivery Location名称。"),
  label: z.string().trim().min(1).max(400).describe("展示给用户选择的Delivery Location名称和字典键。"),
});

const estimatedAppointmentTimeSchema = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/, "Estimated Appointment Time 必须为 YYYY-MM-DD HH:mm:ss。")
  .refine((value) => {
    const [date, time] = value.split(" "); const [year, month, day] = date.split("-").map(Number); const [hour, minute, second] = time.split(":").map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day && parsed.getUTCHours() === hour && parsed.getUTCMinutes() === minute && parsed.getUTCSeconds() === second;
  }, "Estimated Appointment Time 不是有效日期时间。");

export const appointmentTypeOptionSchema = z.object({
  value: z.enum(["跨境", "本土"]).describe("预约单类型的固定值，仅用于恢复本次选择。"),
  name: z.enum(["跨境", "本土"]).describe("预约单类型名称。"),
  label: z.enum(["跨境", "本土"]).describe("展示给用户选择的预约单类型。"),
});

export const appointmentTaskForOptionSchema = z.object({
  value: z.string().trim().min(1).max(120).describe("任务人的稳定 ID，仅用于恢复本次选择。"),
  id: z.string().trim().min(1).max(120).describe("Portmax 任务人 ID。"),
  globalUserId: z.string().trim().min(1).max(120).describe("创建出库计划时提交的全局用户 ID。"),
  globalUserCode: z.string().trim().min(1).max(120).describe("Portmax 返回的全局用户编码；兼容旧上游字段。"),
  name: z.string().trim().min(1).max(240).describe("任务人显示名称。"),
  label: z.string().trim().min(1).max(400).describe("展示给用户选择的任务人。"),
});

export const outboundTemplateSchema = z.object({
  code: z.literal("save_outbound_template"),
  url: z.string().url().max(2_000).describe("字典中配置的出库附件模板下载地址。"),
});

/** 桌面端在用户选择 Excel 后上传、并在最终确认时创建出库计划的固定草稿。 */
export const outboundPlanSubmissionDraftSchema = z.object({
  warehouseName: z.string().trim().min(1).max(240),
  source: z.string().trim().max(240),
  serviceNo: z.string().trim().min(1).max(120),
  deliveryLocation: z.string().trim().min(1).max(120),
  type: z.enum(["跨境", "本土"]),
  estimatedAppointmentTime: estimatedAppointmentTimeSchema,
  remark: z.string().trim().max(1_000),
  globalUserId: z.string().trim().min(1).max(120),
});

const appointmentTypeOptions = [
  { value: "跨境", name: "跨境", label: "跨境" },
  { value: "本土", name: "本土", label: "本土" },
] as const;

export const appointmentWarehouseSelectionPayloadSchema = analyzedInputSchema.extend({
  prompt: z.string().min(1),
  total: z.number().int().nonnegative(),
  truncated: z.boolean(),
  options: z.array(appointmentWarehouseOptionSchema).max(maxWarehouseOptions),
});

const warehouseSelectionOutputSchema = analyzedInputSchema.extend({
  warehouse: appointmentWarehouseOptionSchema,
});

export const appointmentAddOnProductSelectionPayloadSchema = warehouseSelectionOutputSchema.extend({
  prompt: z.string().min(1),
  total: z.number().int().nonnegative(),
  truncated: z.boolean(),
  options: z.array(appointmentAddOnProductOptionSchema).max(maxAddOnProductOptions),
});

const addOnProductSelectionOutputSchema = warehouseSelectionOutputSchema.extend({
  addOnProduct: appointmentAddOnProductOptionSchema,
});

export const appointmentDeliveryLocationSelectionPayloadSchema = addOnProductSelectionOutputSchema.extend({
  prompt: z.string().min(1), total: z.number().int().nonnegative(), truncated: z.boolean(),
  options: z.array(appointmentDeliveryLocationOptionSchema).max(maxDeliveryLocationOptions),
});
const deliveryLocationSelectionOutputSchema = addOnProductSelectionOutputSchema.extend({ deliveryLocation: appointmentDeliveryLocationOptionSchema });
export const appointmentTypeSelectionPayloadSchema = deliveryLocationSelectionOutputSchema.extend({
  prompt: z.string().min(1), total: z.number().int().nonnegative(), truncated: z.boolean(),
  options: z.array(appointmentTypeOptionSchema).length(maxAppointmentTypeOptions),
});
const appointmentTypeSelectionOutputSchema = deliveryLocationSelectionOutputSchema.extend({ appointmentType: appointmentTypeOptionSchema });
export const estimatedAppointmentTimeSelectionPayloadSchema = appointmentTypeSelectionOutputSchema.extend({ prompt: z.string().min(1) });
const estimatedAppointmentTimeSelectionOutputSchema = appointmentTypeSelectionOutputSchema.extend({ estimatedAppointmentTime: estimatedAppointmentTimeSchema });
export const appointmentTaskForSelectionPayloadSchema = estimatedAppointmentTimeSelectionOutputSchema.extend({
  prompt: z.string().min(1), total: z.number().int().nonnegative(), truncated: z.boolean(),
  options: z.array(appointmentTaskForOptionSchema).max(maxTaskForOptions),
});
const taskForSelectionOutputSchema = estimatedAppointmentTimeSelectionOutputSchema.extend({ taskFor: appointmentTaskForOptionSchema });
export const outboundTemplatePreparationPayloadSchema = taskForSelectionOutputSchema.extend({
  template: outboundTemplateSchema,
  submissionDraft: outboundPlanSubmissionDraftSchema,
  prompt: z.string().min(1),
});
const outputSchema = taskForSelectionOutputSchema;

const upstreamEnvelopeSchema = z.object({
  status: z.number().int(),
  body: z.string(),
});

const mcpToolResultSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  isError: z.boolean().optional(),
});

type PortmaxToolExecute = (input: Record<string, unknown>, options: unknown) => Promise<unknown>;

/**
 * Mastra starts with a discovered tool snapshot. If Portmax MCP was upgraded after
 * 4111 started, refresh once before failing instead of requiring a second restart.
 */
async function requirePortmaxTool(toolName: string, subject: string): Promise<PortmaxToolExecute> {
  const execute = (portmaxTools as Record<string, { execute?: unknown }>)[toolName]?.execute;
  if (typeof execute === "function") return execute as PortmaxToolExecute;

  try {
    const refreshedTools = await mcpClient.listTools();
    const refreshedExecute = (refreshedTools as Record<string, { execute?: unknown }>)[toolName]?.execute;
    if (typeof refreshedExecute === "function") return refreshedExecute as PortmaxToolExecute;
  } catch {
    // Preserve the actionable lifecycle error below; the upstream tool list may be unavailable during a restart.
  }

  throw new Error(`portmax_api 未提供可执行的${subject}工具。请先重启 portmax_api（3001），再重启 Mastra client（4111）。`);
}

const warehouseSettingSchema = z.object({
  id: z.string().trim().min(1).max(120),
  warehouseId: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(240),
}).passthrough();
const warehouseSettingsSchema = z.array(warehouseSettingSchema);
const addOnProductMapSchema = z.record(z.string().trim().min(1).max(120), z.string().trim().min(1).max(240));
const dictionaryEntrySchema = z.record(z.string(), z.unknown());

function extractUniqueAppointmentType(request: string): "跨境" | "本土" | undefined {
  const matches = appointmentTypeOptions
    .filter((option) => request.includes(option.value))
    .map((option) => option.value);
  return matches.length === 1 ? matches[0] : undefined;
}

function extractUniqueEstimatedAppointmentTime(request: string): string | undefined {
  const matches = [...request.matchAll(/\b\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}\b/g)]
    .map((match) => match[0].replace("T", " "))
    .filter((value) => estimatedAppointmentTimeSchema.safeParse(value).success);
  const uniqueMatches = [...new Set(matches)];
  return uniqueMatches.length === 1 ? uniqueMatches[0] : undefined;
}

function analyzeAppointmentIntent(request: string): z.infer<typeof appointmentIntentSchema> {
  // 首轮请求先确定性拆解本地可验证字段；依赖上游候选的仓库、产品、地点和任务人
  // 在各自受控查询返回后再进行唯一匹配，避免模型猜测或采用未授权的值。
  const appointmentType = extractUniqueAppointmentType(request);
  const estimatedAppointmentTime = extractUniqueEstimatedAppointmentTime(request);
  const extractedData = [
    ...(appointmentType ? [{ field: "appointmentType", value: appointmentType }] : []),
    ...(estimatedAppointmentTime ? [{ field: "estimatedAppointmentTime", value: estimatedAppointmentTime }] : []),
  ];
  const missingData = [
    ...(appointmentType ? [] : ["appointmentType"]),
    ...(estimatedAppointmentTime ? [] : ["estimatedAppointmentTime"]),
  ];
  return {
    operation: "create-appointment",
    warehouseNameHint: null,
    extractedData,
    missingData,
  };
}

function intentValue(intent: z.infer<typeof appointmentIntentSchema>, field: string): string | undefined {
  return intent.extractedData.find((item) => item.field === field)?.value;
}

function parseMcpResponse(value: unknown, subject: string): unknown {
  const result = mcpToolResultSchema.safeParse(value);
  if (!result.success) throw new Error(`${subject} MCP 工具未返回有效结果。`);
  if (result.data.isError) throw new Error(result.data.content.map((item) => item.text).filter(Boolean).join("\n") || `${subject}查询失败。`);

  const text = result.data.content.find((item) => item.type === "text")?.text;
  if (!text) throw new Error(`${subject} MCP 工具未返回文本响应。`);

  let envelope: z.infer<typeof upstreamEnvelopeSchema>;
  try {
    envelope = upstreamEnvelopeSchema.parse(JSON.parse(text));
  } catch {
    throw new Error(`${subject} MCP 工具返回了无效的上游响应。`);
  }
  if (envelope.status < 200 || envelope.status >= 300) {
    throw new Error(`${subject}查询失败（上游状态 ${envelope.status}）。`);
  }

  try {
    return JSON.parse(envelope.body);
  } catch {
    const preview = envelope.body.replace(/\s+/g, " ").slice(0, 240);
    throw new Error(`${subject}接口返回了无效 JSON${envelope.body ? `：${preview}` : "。"}`);
  }
}

function getWarehouseSettings(value: unknown): z.infer<typeof warehouseSettingsSchema> {
  const direct = warehouseSettingsSchema.safeParse(value);
  if (direct.success) return direct.data;

  const wrapped = z.object({ data: warehouseSettingsSchema }).safeParse(value);
  if (wrapped.success) return wrapped.data.data;

  throw new Error("仓库设置接口返回的数据格式无效。");
}

function getAddOnProductMap(value: unknown): z.infer<typeof addOnProductMapSchema> {
  const direct = addOnProductMapSchema.safeParse(value);
  if (direct.success) return direct.data;

  const wrapped = z.object({ data: addOnProductMapSchema }).safeParse(value);
  if (wrapped.success) return wrapped.data.data;

  throw new Error("附加产品接口返回的数据格式无效。");
}

function asNonBlankString(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const text = String(value).trim();
  return text || undefined;
}

function getDeliveryLocationOptions(value: unknown): z.infer<typeof appointmentDeliveryLocationOptionSchema>[] {
  const findEntries = (root: unknown): unknown[] | undefined => {
    const pending: unknown[] = [root];
    const visited = new Set<object>();
    while (pending.length > 0) {
      const current = pending.shift();
      if (Array.isArray(current)) return current;
      if (typeof current !== "object" || current === null || visited.has(current)) continue;
      visited.add(current);
      const record = current as Record<string, unknown>;
      for (const key of ["data", "records", "list", "items", "rows"]) {
        if (record[key] !== undefined) pending.push(record[key]);
      }
    }
    return undefined;
  };
  const rawEntries = findEntries(value);
  const parsedEntries = z.array(dictionaryEntrySchema).safeParse(rawEntries);
  if (!parsedEntries.success) {
    throw new Error("Delivery Location字典返回的数据格式无效。期望 data、records、list、items 或 rows 中包含字典项数组。");
  }

  const field = (entry: Record<string, unknown>, keys: readonly string[]): string | undefined => {
    for (const key of keys) {
      const text = asNonBlankString(entry[key]);
      if (text) return text;
    }
    return undefined;
  };
  const options = parsedEntries.data.map((entry) => {
    const value = field(entry, ["dictKey", "dictionaryKey", "value", "key", "code", "id"]);
    const name = field(entry, ["dictValue", "dictionaryValue", "label", "name", "title"]);
    if (!value || !name) {
      throw new Error("Delivery Location字典包含缺少稳定键或名称的条目。支持 dictKey/dictValue、dictionaryKey/dictionaryValue、value/label 或 code/name。");
    }
    return {
      value,
      name,
      label: name === value ? name : `${name}（${value}）`,
    };
  });
  if (new Set(options.map((option) => option.value)).size !== options.length) {
    throw new Error("Delivery Location字典包含重复的稳定键。");
  }
  return options;
}

function getTaskForOptions(value: unknown): z.infer<typeof appointmentTaskForOptionSchema>[] {
  const findEntries = (root: unknown): unknown[] | undefined => {
    const pending: unknown[] = [root];
    const visited = new Set<object>();
    while (pending.length > 0) {
      const current = pending.shift();
      if (Array.isArray(current)) return current;
      if (typeof current !== "object" || current === null || visited.has(current)) continue;
      visited.add(current);
      const record = current as Record<string, unknown>;
      for (const key of ["data", "records", "list", "items", "rows"]) {
        if (record[key] !== undefined) pending.push(record[key]);
      }
    }
    return undefined;
  };
  const rawEntries = findEntries(value);
  const parsedEntries = z.array(dictionaryEntrySchema).safeParse(rawEntries);
  if (!parsedEntries.success) {
    throw new Error("Task For 接口返回的数据格式无效。期望 data、records、list、items 或 rows 中包含用户数组。");
  }

  const field = (entry: Record<string, unknown>, keys: readonly string[]): string | undefined => {
    for (const key of keys) {
      const text = asNonBlankString(entry[key]);
      if (text) return text;
    }
    return undefined;
  };
  const options = parsedEntries.data.map((entry) => {
    const id = field(entry, ["id", "userId", "user_id"]);
    // 新版创建接口使用 globalUserId；旧上游仍可能只返回 globalUserCode，因此保留并映射该兼容字段。
    const globalUserId = field(entry, ["globalUserId", "globalUserCode"]);
    const globalUserCode = field(entry, ["globalUserCode", "globalUserId"]);
    const name = field(entry, ["realName", "real_name", "name", "userName", "user_name", "account", "nickName", "nick_name"]);
    if (!id || !globalUserId || !globalUserCode || !name) {
      throw new Error("Task For 接口包含无法安全映射的用户。必须返回 id/userId/user_id、globalUserId 或 globalUserCode 和显示名称。");
    }
    return { value: id, id, globalUserId, globalUserCode, name, label: name === id ? name : `${name}（${id}）` };
  });
  if (new Set(options.map((option) => option.value)).size !== options.length) {
    throw new Error("Task For 接口包含重复的稳定用户 ID。");
  }
  return options;
}

function getOutboundTemplate(value: unknown): z.infer<typeof outboundTemplateSchema> {
  const findEntries = (root: unknown): Record<string, unknown>[] | undefined => {
    const pending: unknown[] = [root];
    const visited = new Set<object>();
    while (pending.length > 0) {
      const current = pending.shift();
      if (Array.isArray(current)) {
        const entries = z.array(dictionaryEntrySchema).safeParse(current);
        return entries.success ? entries.data : undefined;
      }
      if (typeof current !== "object" || current === null || visited.has(current)) continue;
      visited.add(current);
      const record = current as Record<string, unknown>;
      for (const key of ["data", "records", "list", "items", "rows"]) {
        if (record[key] !== undefined) pending.push(record[key]);
      }
    }
    return undefined;
  };
  const templateEntry = findEntries(value)?.find((entry) => entry.dictKey === "save_outbound_template");
  const url = asNonBlankString(templateEntry?.dictValue);
  if (!url) throw new Error("出库模板字典未返回 dictKey 为 save_outbound_template 的下载地址。");

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    throw new Error("出库模板字典返回了无效的下载地址。");
  }
  if (parsedUrl.protocol !== "https:" || parsedUrl.origin !== "https://portmax-v2-prod.oss-cn-hangzhou.aliyuncs.com") {
    throw new Error("出库模板下载地址不属于受信任的 Portmax OSS HTTPS 来源。");
  }
  return { code: "save_outbound_template", url: parsedUrl.toString() };
}

function normalizeSelectionText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[^a-z0-9\u4e00-\u9fff]/gi, "");
}

function findUniqueExplicitOption<T extends { label: string; name: string }>(
  request: string,
  options: readonly T[],
  identifiers: (option: T) => readonly string[],
): T | undefined {
  const normalizedRequest = normalizeSelectionText(request);
  const matchingOptions = (values: (option: T) => readonly string[]): T[] => options.filter((option) =>
    values(option)
      .map(normalizeSelectionText)
      .filter((candidate) => candidate.length >= 4)
      .some((candidate) => normalizedRequest.includes(candidate)),
  );
  const uniqueMatch = (matches: readonly T[]): T | undefined => matches.length === 1 ? matches[0] : undefined;

  // 完整展示标签优先：例如“时区仓库24（WHCN086）”不能被短名称“仓库24”干扰。
  const labelMatches = matchingOptions((option) => [option.label]);
  if (labelMatches.length > 0) return uniqueMatch(labelMatches);

  const identifierMatches = matchingOptions(identifiers);
  if (identifierMatches.length > 0) return uniqueMatch(identifierMatches);

  return uniqueMatch(matchingOptions((option) => [option.name]));
}

const analyzeAppointmentRequest = createStep({
  id: "analyze-create-appointment-intent",
  description: "准备预约单请求；后续步骤仅从 Portmax 候选中确定性匹配用户明确提供的值。",
  inputSchema,
  outputSchema: analyzedInputSchema,
  execute: async ({ inputData }) => ({
    request: inputData.request,
    intent: analyzeAppointmentIntent(inputData.request),
    dataFetchPlan: "warehouse-settings" as const,
  }),
});

export const selectAppointmentWarehouseNameStep = createStep({
  id: appointmentWarehouseSelectionStepId,
  description: "通过 portmax_api MCP 查询仓库设置；唯一匹配用户明确输入的仓库，否则暂停等待选择。",
  inputSchema: analyzedInputSchema,
  resumeSchema: z.object({ warehouseValue: z.string().trim().min(1).max(120) }),
  suspendSchema: appointmentWarehouseSelectionPayloadSchema,
  outputSchema: warehouseSelectionOutputSchema,
  requestContextSchema: portmaxRequestContextSchema,
  execute: async ({ inputData, requestContext, resumeData, suspend, suspendData }) => {
    if (resumeData?.warehouseValue) {
      const warehouse = suspendData?.options.find((option) => option.value === resumeData.warehouseValue);
      if (!warehouse) throw new Error("所选仓库不属于本次预约单流程的候选项。");
      return { ...inputData, warehouse };
    }

    const bladeAuth = requestContext.get("portmax-blade-auth");
    if (!bladeAuth) {
      throw new Error("当前 Workflow 运行没有 Portmax 登录会话。请从已登录的桌面聊天入口调用 Agent；不要在请求中粘贴 Blade-Auth。");
    }

    const executeWarehouseTool = await requirePortmaxTool("portmax_get_warehouse_settings", "仓库设置查询");

    const result = await executeWarehouseTool({ warehouseName: "" }, { requestContext } as never);
    const warehouseSettings = getWarehouseSettings(parseMcpResponse(result, "仓库设置"));
    const allOptions = warehouseSettings.map((warehouse) => ({
      value: warehouse.id,
      id: warehouse.id,
      warehouseId: warehouse.warehouseId,
      name: warehouse.name,
      source: asNonBlankString(warehouse.source),
      natureOfOperations: asNonBlankString(warehouse.natureOfOperations),
      label: `${warehouse.name}（${warehouse.warehouseId}）`,
    }));
    const explicitlyRequestedWarehouse = findUniqueExplicitOption(
      inputData.request,
      allOptions,
      (warehouse) => [warehouse.warehouseId, warehouse.id],
    );
    if (explicitlyRequestedWarehouse) return { ...inputData, warehouse: explicitlyRequestedWarehouse };

    const options = allOptions.slice(0, maxWarehouseOptions);
    return suspend({
      ...inputData,
      prompt: options.length > 0
        ? "未能从本次请求中唯一确定仓库，请选择仓库后继续创建预约单。当前流程只收集预约单草稿，不会提交或创建任何记录。"
        : "未查询到可用的仓库设置，暂时无法继续创建预约单。",
      total: allOptions.length,
      truncated: allOptions.length > options.length,
      options,
    });
  },
});

export const selectAppointmentAddOnProductStep = createStep({
  id: appointmentAddOnProductSelectionStepId,
  description: "通过 portmax_api MCP 查询 Add-on Product；唯一匹配用户明确输入的产品，否则暂停等待选择。",
  inputSchema: warehouseSelectionOutputSchema,
  resumeSchema: z.object({ addOnProductValue: z.string().trim().min(1).max(120) }),
  suspendSchema: appointmentAddOnProductSelectionPayloadSchema,
  outputSchema: addOnProductSelectionOutputSchema,
  requestContextSchema: portmaxRequestContextSchema,
  execute: async ({ inputData, requestContext, resumeData, suspend, suspendData }) => {
    if (resumeData?.addOnProductValue) {
      const addOnProduct = suspendData?.options.find((option) => option.value === resumeData.addOnProductValue);
      if (!addOnProduct) throw new Error("所选 Add-on Product 不属于本次预约单流程的候选项。");
      return { ...inputData, addOnProduct };
    }

    const bladeAuth = requestContext.get("portmax-blade-auth");
    if (!bladeAuth) {
      throw new Error("当前 Workflow 运行没有 Portmax 登录会话。请从已登录的桌面聊天入口调用 Agent；不要在请求中粘贴 Blade-Auth。");
    }

    const executeAddOnProductTool = await requirePortmaxTool("portmax_get_add_on_products", "Add-on Product 查询");

    const result = await executeAddOnProductTool({}, { requestContext } as never);
    const productMap = getAddOnProductMap(parseMcpResponse(result, "附加产品"));
    const allOptions = Object.entries(productMap).map(([code, name]) => ({
      value: code,
      code,
      name,
      label: `${name}（${code}）`,
    }));
    const explicitlyRequestedProduct = findUniqueExplicitOption(
      inputData.request,
      allOptions,
      (addOnProduct) => [addOnProduct.code],
    );
    if (explicitlyRequestedProduct) return { ...inputData, addOnProduct: explicitlyRequestedProduct };

    const options = allOptions.slice(0, maxAddOnProductOptions);
    return suspend({
      ...inputData,
      prompt: options.length > 0
        ? `已选择仓库“${inputData.warehouse.label}”，但未能从本次请求中唯一确定 Add-on Product，请选择后继续。当前流程只收集预约单草稿，不会提交或创建任何记录。`
        : "未查询到可用的 Add-on Product，暂时无法继续创建预约单。",
      total: allOptions.length,
      truncated: allOptions.length > options.length,
      options,
    });
  },
});

export const selectAppointmentDeliveryLocationStep = createStep({
  id: appointmentDeliveryLocationSelectionStepId,
  description: "通过 portmax_api MCP 查询Delivery Location字典，并暂停等待用户选择。",
  inputSchema: addOnProductSelectionOutputSchema,
  resumeSchema: z.object({ deliveryLocationValue: z.string().trim().min(1).max(120) }),
  suspendSchema: appointmentDeliveryLocationSelectionPayloadSchema,
  outputSchema: deliveryLocationSelectionOutputSchema,
  requestContextSchema: portmaxRequestContextSchema,
  execute: async ({ inputData, requestContext, resumeData, suspend, suspendData }) => {
    if (resumeData?.deliveryLocationValue) {
      const deliveryLocation = suspendData?.options.find((option) => option.value === resumeData.deliveryLocationValue);
      if (!deliveryLocation) throw new Error("所选Delivery Location不属于本次预约单流程的候选项。");
      return { ...inputData, deliveryLocation };
    }

    const bladeAuth = requestContext.get("portmax-blade-auth");
    if (!bladeAuth) {
      throw new Error("当前 Workflow 运行没有 Portmax 登录会话。请从已登录的桌面聊天入口调用 Agent；不要在请求中粘贴 Blade-Auth。");
    }

    const executeDictionaryTool = await requirePortmaxTool("portmax_search_dict", "字典查询");

    const result = await executeDictionaryTool(
      { code: "Appointment_Delivery_Location" },
      { requestContext } as never,
    );
    const allOptions = getDeliveryLocationOptions(parseMcpResponse(result, "Delivery Location字典"));
    const explicitlyRequestedDeliveryLocation = findUniqueExplicitOption(
      inputData.request,
      allOptions,
      (deliveryLocation) => [deliveryLocation.value],
    );
    if (explicitlyRequestedDeliveryLocation) return { ...inputData, deliveryLocation: explicitlyRequestedDeliveryLocation };

    const options = allOptions.slice(0, maxDeliveryLocationOptions);
    return suspend({
      ...inputData,
      prompt: options.length > 0
        ? `已选择仓库“${inputData.warehouse.label}”和附加产品“${inputData.addOnProduct.label}”，请选择Delivery Location后继续创建预约单。当前流程只收集预约单草稿，不会提交或创建任何记录。`
        : "Delivery Location字典未返回可选择的项目，暂时无法继续创建预约单。",
      total: allOptions.length,
      truncated: allOptions.length > options.length,
      options,
    });
  },
});

export const selectAppointmentTypeStep = createStep({
  id: appointmentTypeSelectionStepId,
  description: "展示固定的预约单类型候选，并暂停等待用户选择。",
  inputSchema: deliveryLocationSelectionOutputSchema,
  resumeSchema: z.object({ appointmentTypeValue: z.enum(["跨境", "本土"]) }),
  suspendSchema: appointmentTypeSelectionPayloadSchema,
  outputSchema: appointmentTypeSelectionOutputSchema,
  execute: async ({ inputData, resumeData, suspend, suspendData }) => {
    if (resumeData?.appointmentTypeValue) {
      const appointmentType = suspendData?.options.find((option) => option.value === resumeData.appointmentTypeValue);
      if (!appointmentType) throw new Error("所选预约单类型不属于本次预约单流程的候选项。");
      return { ...inputData, appointmentType };
    }
    const explicitlyRequestedType = intentValue(inputData.intent, "appointmentType");
    const appointmentType = appointmentTypeOptions.find((option) => option.value === explicitlyRequestedType);
    if (appointmentType) return { ...inputData, appointmentType };

    return suspend({
      ...inputData,
      prompt: `已选择仓库“${inputData.warehouse.label}”、附加产品“${inputData.addOnProduct.label}”和 Delivery Location“${inputData.deliveryLocation.label}”，请选择预约单类型后继续创建预约单。当前流程只收集预约单草稿，不会提交或创建任何记录。`,
      total: appointmentTypeOptions.length, truncated: false, options: [...appointmentTypeOptions],
    });
  },
});

export const selectEstimatedAppointmentTimeStep = createStep({
  id: estimatedAppointmentTimeSelectionStepId,
  description: "暂停等待用户选择 Estimated Appointment Time（YYYY-MM-DD HH:mm:ss）。",
  inputSchema: appointmentTypeSelectionOutputSchema,
  resumeSchema: z.object({ estimatedAppointmentTime: estimatedAppointmentTimeSchema }),
  suspendSchema: estimatedAppointmentTimeSelectionPayloadSchema,
  outputSchema: estimatedAppointmentTimeSelectionOutputSchema,
  execute: async ({ inputData, resumeData, suspend }) => {
    if (resumeData?.estimatedAppointmentTime) return { ...inputData, estimatedAppointmentTime: resumeData.estimatedAppointmentTime };
    const explicitlyRequestedTime = intentValue(inputData.intent, "estimatedAppointmentTime");
    if (explicitlyRequestedTime) return { ...inputData, estimatedAppointmentTime: explicitlyRequestedTime };
    return suspend({ ...inputData, prompt: `已选择仓库、附加产品、Delivery Location 和预约单类型“${inputData.appointmentType.label}”，请选择 Estimated Appointment Time（YYYY-MM-DD HH:mm:ss）后继续。` });
  },
});

export const selectAppointmentTaskForStep = createStep({
  id: appointmentTaskForSelectionStepId,
  description: "通过 portmax_api MCP 查询固定 flow code 60 的 Task For 用户，并暂停等待选择。",
  inputSchema: estimatedAppointmentTimeSelectionOutputSchema,
  resumeSchema: z.object({ taskForValue: z.string().trim().min(1).max(120) }),
  suspendSchema: appointmentTaskForSelectionPayloadSchema,
  outputSchema: taskForSelectionOutputSchema,
  requestContextSchema: portmaxRequestContextSchema,
  execute: async ({ inputData, requestContext, resumeData, suspend, suspendData }) => {
    if (resumeData?.taskForValue) {
      const taskFor = suspendData?.options.find((option) => option.value === resumeData.taskForValue);
      if (!taskFor) throw new Error("所选 Task For 不属于本次预约单流程的候选项。");
      return { ...inputData, taskFor };
    }

    const bladeAuth = requestContext.get("portmax-blade-auth");
    if (!bladeAuth) {
      throw new Error("当前 Workflow 运行没有 Portmax 登录会话。请从已登录的桌面聊天入口调用 Agent；不要在请求中粘贴 Blade-Auth。");
    }

    const executeTaskForTool = await requirePortmaxTool("portmax_get_task_for_users_by_flow", "Task For 查询");

    const result = await executeTaskForTool({}, { requestContext } as never);
    const allOptions = getTaskForOptions(parseMcpResponse(result, "Task For"));
    const explicitlyRequestedTaskFor = findUniqueExplicitOption(
      inputData.request,
      allOptions,
      (taskFor) => [taskFor.id],
    );
    if (explicitlyRequestedTaskFor) return { ...inputData, taskFor: explicitlyRequestedTaskFor };

    const options = allOptions.slice(0, maxTaskForOptions);
    return suspend({
      ...inputData,
      prompt: options.length > 0
        ? `已选择仓库、附加产品、Delivery Location、预约单类型和 Estimated Appointment Time“${inputData.estimatedAppointmentTime}”，请选择 Task For 后继续创建预约单。当前流程只收集预约单草稿，不会提交或创建任何记录。`
        : "Task For 接口未返回可选择的用户，暂时无法继续创建预约单。",
      total: allOptions.length,
      truncated: allOptions.length > options.length,
      options,
    });
  },
});

export const prepareAppointmentAttachmentStep = createStep({
  id: outboundTemplatePreparationStepId,
  description: "固定查询 template_download_url 字典，匹配 dictKey 为 save_outbound_template 的模板，并在同一桌面卡片中引导用户下载、选择 Excel 后显式 Save。",
  inputSchema: taskForSelectionOutputSchema,
  suspendSchema: outboundTemplatePreparationPayloadSchema,
  outputSchema,
  requestContextSchema: portmaxRequestContextSchema,
  execute: async ({ inputData, requestContext, suspend }) => {
    const bladeAuth = requestContext.get("portmax-blade-auth");
    if (!bladeAuth) {
      throw new Error("当前 Workflow 运行没有 Portmax 登录会话。请从已登录的桌面聊天入口调用 Agent；不要在请求中粘贴 Blade-Auth。");
    }
    const executeDictionaryTool = await requirePortmaxTool("portmax_search_dict", "字典查询");

    const result = await executeDictionaryTool({ code: "template_download_url" }, { requestContext } as never);
    const template = getOutboundTemplate(parseMcpResponse(result, "出库模板字典"));
    const submissionDraft = {
      warehouseName: inputData.warehouse.name,
      source: inputData.warehouse.source ?? inputData.warehouse.natureOfOperations ?? "",
      serviceNo: inputData.addOnProduct.code,
      // React 表单提交的是字典 dictKey，而非展示文案。
      deliveryLocation: inputData.deliveryLocation.value,
      type: inputData.appointmentType.value,
      estimatedAppointmentTime: inputData.estimatedAppointmentTime,
      // 备注由最终 Save 卡片编辑；此处提供与 API 相同的默认值。
      remark: "",
      globalUserId: inputData.taskFor.globalUserId,
    };
    return suspend({
      ...inputData,
      template,
      submissionDraft,
      prompt: "请下载并填写出库附件模板，然后选择已填写的 Excel 文件。选定文件后桌面端会立即调用 outboundPlanUpload 解析并取得 boxList 和 exceptionData；exceptionData 会显示为警告但不阻止创建。随后只有在你明确确认 Save 时，桌面端才会使用 submissionDraft、boxList 与 exceptionData 通过 JSON 创建出库计划；不会重新上传、自动提交或自动重试。",
    });
  },
});

/** 创建预约单的前置流程：匹配仓库和 Add-on Product，再选择 Delivery Location、类型、预计时间、Task For 与附件模板。 */
export const createAppointmentWorkflow = createWorkflow({
  id: "create-appointment-workflow", description: "创建预约单：选择仓库、产品、Delivery Location、类型、预计时间、Task For 与附件模板。", inputSchema, outputSchema, requestContextSchema: portmaxRequestContextSchema,
})
  .then(analyzeAppointmentRequest).then(selectAppointmentWarehouseNameStep).then(selectAppointmentAddOnProductStep)
  .then(selectAppointmentDeliveryLocationStep).then(selectAppointmentTypeStep).then(selectEstimatedAppointmentTimeStep).then(selectAppointmentTaskForStep).then(prepareAppointmentAttachmentStep).commit();
