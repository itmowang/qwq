import { Hono } from "hono";
import { z } from "zod";
import { forwardUpstream, selectForwardHeaders, selectResponseHeaders } from "./proxy.js";

const tokenRequestSchema = z.object({
  tenantId: z.string().trim().min(1).max(128),
  username: z.string().trim().min(1).max(256),
  password: z.string().min(1).max(1024),
  scope: z.string().trim().min(1).max(256).default("all"),
  type: z.string().trim().min(1).max(64).default("account"),
});

const warehouseNameSchema = z.string().trim().max(128).optional().default("");
const todoTimeStateSchema = z.enum(["Normal", "Urgent", "Overdue"]);
const maxCredentialLength = 4096;
const maxTenantIdLength = 128;
const maxOutboundPlanFileBytes = 4 * 1024 * 1024;
const maxOutboundPlanUploadRequestBytes = maxOutboundPlanFileBytes + 64 * 1024;
const maxOutboundPlanCreateRequestBytes = maxOutboundPlanFileBytes + 64 * 1024;
const allowedOutboundPlanFileTypes = new Set([
  "",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);
const outboundPlanParsedListSchema = z.array(z.unknown()).max(10_000);
const outboundPlanCreateSchema = z.object({
  warehouseName: z.string().trim().min(1).max(240),
  source: z.string().trim().max(240),
  serviceNo: z.string().trim().min(1).max(120),
  deliveryLocation: z.string().trim().min(1).max(120),
  type: z.enum(["跨境", "本土"]),
  estimatedAppointmentTime: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/).max(19),
  remark: z.string().trim().max(1_000),
  globalUserId: z.string().trim().min(1).max(120),
  boxList: outboundPlanParsedListSchema,
  // 上传解析接口以文本形式返回异常明细；异常不阻止最终创建。
  exceptionData: z.string().max(4 * 1024 * 1024),
}).strict();

function authenticatedOutboundSession(c: { req: { header: (name: string) => string | undefined } }): { bladeAuth: string; tenantId?: string } | Response {
  const bladeAuth = c.req.header("x-portmax-blade-auth")?.trim();
  if (!bladeAuth || bladeAuth.length > maxCredentialLength) {
    return new Response(JSON.stringify({ error: "A valid X-Portmax-Blade-Auth header is required." }), { status: 401, headers: { "content-type": "application/json" } });
  }
  const tenantId = c.req.header("x-portmax-tenant-id")?.trim();
  if (tenantId && tenantId.length > maxTenantIdLength) {
    return new Response(JSON.stringify({ error: "Invalid X-Portmax-Tenant-Id header." }), { status: 400, headers: { "content-type": "application/json" } });
  }
  return { bladeAuth, ...(tenantId ? { tenantId } : {}) };
}
const defaultBladeOAuthAuthorization = "Basic c2FiZXI6c2FiZXJfc2VjcmV0";

function getBladeOAuthAuthorization(): string {
  const authorization = process.env.PORTMAX_BLADE_OAUTH_AUTHORIZATION?.trim() || defaultBladeOAuthAuthorization;

  if (!authorization.startsWith("Basic ")) {
    throw new Error("PORTMAX_BLADE_OAUTH_AUTHORIZATION must contain the upstream Basic client credential.");
  }

  return authorization;
}

export const httpRoutes = new Hono();

/**
 * 上游 OAuth password-grant 登录代理。
 * 将 desktop 提交的租户、用户名和密码转为上游查询参数，并从服务端环境变量注入 Basic 客户端凭据。
 */
httpRoutes.post("/auth/token", async (c) => {
  if (!c.req.header("content-type")?.toLowerCase().startsWith("application/x-www-form-urlencoded")) {
    return c.json({ error: "Content-Type must be application/x-www-form-urlencoded." }, 415);
  }

  const parsedRequest = tokenRequestSchema.safeParse(Object.fromEntries(await c.req.formData()));
  if (!parsedRequest.success) {
    return c.json({ error: "tenantId, username, and password are required." }, 400);
  }

  const { tenantId, username, password, scope, type } = parsedRequest.data;
  const query = new URLSearchParams({
    tenantId,
    username,
    password,
    grant_type: "password",
    scope,
    type,
  });

  try {
    const upstreamResponse = await forwardUpstream({
      path: `/api/blade-auth/oauth/token?${query.toString()}`,
      method: "POST",
      headers: {
        accept: "application/json, text/plain, */*",
        "content-type": "application/x-www-form-urlencoded",
        "tenant-id": tenantId,
      },
      authorization: getBladeOAuthAuthorization(),
    });

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: selectResponseHeaders(upstreamResponse.headers),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Token request failed.";
    return c.json({ error: message }, 502);
  }
});

/**
 * 按仓库名称查询仓库设置。路径和请求方法固定，凭据只从受控请求头取得，
 * 不接受调用方提供的上游路径、Authorization 或 Cookie。
 */
httpRoutes.get("/warehouse-settings/by-name", async (c) => {
  const parsedWarehouseName = warehouseNameSchema.safeParse(c.req.query("warehouseName"));
  if (!parsedWarehouseName.success) {
    return c.json({ error: "warehouseName must be a string up to 128 characters." }, 400);
  }

  const rawBladeAuth = c.req.header("x-portmax-blade-auth");
  const bladeAuth = rawBladeAuth?.trim();
  if (!bladeAuth || bladeAuth.length > maxCredentialLength) {
    return c.json({ error: "A valid X-Portmax-Blade-Auth header is required." }, 401);
  }

  const tenantId = c.req.header("x-portmax-tenant-id")?.trim();
  if (tenantId && tenantId.length > maxTenantIdLength) {
    return c.json({ error: "Invalid X-Portmax-Tenant-Id header." }, 400);
  }

  try {
    const query = new URLSearchParams({ warehouseName: parsedWarehouseName.data });
    const upstreamResponse = await forwardUpstream({
      path: `/api/blade-shipment/setting/getSettingByWarehouseName?${query.toString()}`,
      method: "GET",
      headers: {
        accept: "application/json, text/plain, */*",
        "blade-auth": bladeAuth,
        "blade-requested-with": "BladeHttpRequest",
        ...(tenantId ? { "tenant-id": tenantId } : {}),
      },
      // 此查询必须使用当前登录用户的 Blade-Auth，不回退到通用服务凭据。
      authorization: "",
    });

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: selectResponseHeaders(upstreamResponse.headers),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Warehouse setting request failed.";
    return c.json({ error: message }, 502);
  }
});

/**
 * 当前登录用户的任务统计与列表代理。上游路径、分类、页码和状态均受限，
 * 避免调用方透传任意 Blade 路径或使用服务身份读取其他用户的任务。
 */
httpRoutes.get("/work-todos/count", async (c) => {
  const session = authenticatedOutboundSession(c);
  if (session instanceof Response) return session;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await forwardUpstream({
        path: "/api/blade-flow/work/todo-list-count?type=single",
        method: "GET",
        headers: {
          accept: "application/json, text/plain, */*",
          "blade-auth": session.bladeAuth,
          "blade-requested-with": "BladeHttpRequest",
          ...(session.tenantId ? { "tenant-id": session.tenantId } : {}),
        },
        signal: controller.signal,
        authorization: "",
      });
      return new Response(response.body, { status: response.status, headers: selectResponseHeaders(response.headers) });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return c.json({ error: "The upstream todo count request timed out." }, 504);
    return c.json({ error: error instanceof Error ? error.message : "Todo count request failed." }, 502);
  }
});

httpRoutes.get("/work-todos", async (c) => {
  const parsedTimeState = todoTimeStateSchema.safeParse(c.req.query("timeState"));
  if (!parsedTimeState.success) return c.json({ error: "timeState must be Normal, Urgent, or Overdue." }, 400);
  const session = authenticatedOutboundSession(c);
  if (session instanceof Response) return session;

  try {
    const query = new URLSearchParams({
      current: "1",
      size: "50",
      category: "single",
      timeState: parsedTimeState.data,
      creatTimeN: "",
      processDefinitionKey: "",
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await forwardUpstream({
        path: `/api/blade-flow/work/todoList?${query.toString()}`,
        method: "GET",
        headers: {
          accept: "application/json, text/plain, */*",
          "blade-auth": session.bladeAuth,
          "blade-requested-with": "BladeHttpRequest",
          ...(session.tenantId ? { "tenant-id": session.tenantId } : {}),
        },
        signal: controller.signal,
        authorization: "",
      });
      return new Response(response.body, { status: response.status, headers: selectResponseHeaders(response.headers) });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return c.json({ error: "The upstream todo list request timed out." }, 504);
    return c.json({ error: error instanceof Error ? error.message : "Todo list request failed." }, 502);
  }
});

/** Excel is parsed immediately; only file + warehouseName are accepted in this multipart relay. */
httpRoutes.post("/outbound-schedule/upload", async (c) => {
  if (!c.req.header("content-type")?.toLowerCase().startsWith("multipart/form-data")) return c.json({ error: "Content-Type must be multipart/form-data." }, 415);
  const contentLength = Number(c.req.header("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxOutboundPlanUploadRequestBytes) return c.json({ error: "The outbound attachment exceeds the 4 MiB limit." }, 413);
  const session = authenticatedOutboundSession(c);
  if (session instanceof Response) return session;
  try {
    const form = await c.req.formData();
    const expectedNames = new Set(["file", "warehouseName"]);
    if ([...form.entries()].some(([name]) => !expectedNames.has(name)) || [...expectedNames].some((name) => form.getAll(name).length !== 1)) return c.json({ error: "The outbound upload form must contain exactly one file and warehouseName." }, 400);
    const warehouseName = z.string().trim().min(1).max(240).safeParse(form.get("warehouseName"));
    const file = form.get("file");
    if (!warehouseName.success || !(file instanceof File) || !file.name || file.name.length > 255 || /[\\/\u0000-\u001f]/.test(file.name) || !/\.(xlsx|xls)$/i.test(file.name) || file.size <= 0 || file.size > maxOutboundPlanFileBytes || !allowedOutboundPlanFileTypes.has(file.type.toLowerCase())) return c.json({ error: "warehouseName and a non-empty Excel (.xlsx or .xls) file no larger than 4 MiB are required." }, 400);
    const upstreamForm = new FormData();
    upstreamForm.set("file", file, file.name);
    upstreamForm.set("warehouseName", warehouseName.data);
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await forwardUpstream({ path: "/api/blade-order/schedule/outbound/outboundPlanUpload", method: "POST", headers: { accept: "application/json, text/plain, */*", "blade-auth": session.bladeAuth, "blade-requested-with": "BladeHttpRequest", ...(session.tenantId ? { "tenant-id": session.tenantId } : {}) }, body: upstreamForm, signal: controller.signal, authorization: "" });
      return new Response(response.body, { status: response.status, headers: selectResponseHeaders(response.headers) });
    } finally { clearTimeout(timeout); }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return c.json({ error: "The upstream outbound upload request timed out." }, 504);
    return c.json({ error: error instanceof Error ? error.message : "Outbound upload request failed." }, 502);
  }
});

/** Final creation accepts the validated draft and parsed data as JSON; never multipart/form-data. */
httpRoutes.post("/outbound-schedule/create", async (c) => {
  if (!c.req.header("content-type")?.toLowerCase().startsWith("application/json")) return c.json({ error: "Content-Type must be application/json." }, 415);
  const contentLength = Number(c.req.header("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxOutboundPlanCreateRequestBytes) return c.json({ error: "The outbound create payload exceeds the allowed size." }, 413);
  const session = authenticatedOutboundSession(c);
  if (session instanceof Response) return session;
  try {
    const body = outboundPlanCreateSchema.safeParse(await c.req.json());
    if (!body.success) return c.json({ error: "The outbound create JSON contains invalid or unexpected fields." }, 400);
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const response = await forwardUpstream({ path: "/api/blade-order/schedule/outbound/save", method: "POST", headers: { accept: "application/json, text/plain, */*", "content-type": "application/json", "blade-auth": session.bladeAuth, "blade-requested-with": "BladeHttpRequest", ...(session.tenantId ? { "tenant-id": session.tenantId } : {}) }, body: JSON.stringify(body.data), signal: controller.signal, authorization: "" });
      return new Response(response.body, { status: response.status, headers: selectResponseHeaders(response.headers) });
    } finally { clearTimeout(timeout); }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") return c.json({ error: "The upstream outbound create request timed out." }, 504);
    return c.json({ error: error instanceof Error ? error.message : "Outbound create request failed." }, 502);
  }
});

httpRoutes.all("/proxy/*", async (c) => {
  const path = c.req.path.slice("/proxy".length);
  if (path === "/" || !path) {
    return c.json({ error: "Provide an upstream path after /proxy." }, 400);
  }

  try {
    const method = c.req.method;
    const body = method === "GET" || method === "HEAD" ? undefined : await c.req.raw.arrayBuffer();
    const upstreamResponse = await forwardUpstream({
      path: `${path}${new URL(c.req.url).search}`,
      method,
      headers: Object.fromEntries(selectForwardHeaders(c.req.raw.headers)),
      body,
    });

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      headers: selectResponseHeaders(upstreamResponse.headers),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upstream request failed.";
    return c.json({ error: message }, 502);
  }
});
