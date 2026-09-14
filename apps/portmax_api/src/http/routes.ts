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
const maxCredentialLength = 4096;
const maxTenantIdLength = 128;
const maxOutboundSaveFileBytes = 4 * 1024 * 1024;
const maxOutboundSaveRequestBytes = maxOutboundSaveFileBytes + 64 * 1024;
const allowedOutboundSaveFileTypes = new Set([
  "",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);
const outboundSaveFieldNames = [
  "warehouseName",
  "source",
  "serviceNo",
  "deliveryLocation",
  "type",
  "estimatedAppointmentTime",
  "remark",
  "globalUserId",
] as const;
const outboundSaveFormSchema = z.object({
  warehouseName: z.string().trim().min(1).max(240),
  source: z.string().trim().max(240),
  serviceNo: z.string().trim().min(1).max(120),
  deliveryLocation: z.string().trim().min(1).max(120),
  type: z.enum(["跨境", "本土"]),
  estimatedAppointmentTime: z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/).max(19),
  remark: z.string().trim().max(1_000),
  globalUserId: z.string().trim().min(1).max(120),
});
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
 * 正式创建出库预约单的固定 multipart 中继。
 * 只接受受控的预约字段与一个 Excel 文件；上游路径、鉴权、Cookie 和其他表单字段均不可由调用方指定。
 */
httpRoutes.post("/outbound-schedule/save", async (c) => {
  if (!c.req.header("content-type")?.toLowerCase().startsWith("multipart/form-data")) {
    return c.json({ error: "Content-Type must be multipart/form-data." }, 415);
  }

  const contentLength = Number(c.req.header("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxOutboundSaveRequestBytes) {
    return c.json({ error: "The outbound attachment exceeds the 4 MiB limit." }, 413);
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
    const form = await c.req.formData();
    const expectedNames = new Set<string>(["file", ...outboundSaveFieldNames]);
    const entries = [...form.entries()];
    if (entries.some(([name]) => !expectedNames.has(name))
      || [...expectedNames].some((name) => form.getAll(name).length !== 1)) {
      return c.json({ error: "The outbound save form must contain exactly one file and the required fixed fields." }, 400);
    }

    const parsedFields = outboundSaveFormSchema.safeParse(
      Object.fromEntries(outboundSaveFieldNames.map((name) => [name, form.get(name)])),
    );
    if (!parsedFields.success) {
      return c.json({ error: "The outbound save form contains invalid fields." }, 400);
    }

    const file = form.get("file");
    if (!(file instanceof File)
      || !file.name
      || file.name.length > 255
      || /[\\/\u0000-\u001f]/.test(file.name)
      || !/\.(xlsx|xls)$/i.test(file.name)
      || file.size <= 0
      || file.size > maxOutboundSaveFileBytes
      || !allowedOutboundSaveFileTypes.has(file.type.toLowerCase())) {
      return c.json({ error: "file must be a non-empty Excel (.xlsx or .xls) file no larger than 4 MiB." }, 400);
    }

    const upstreamForm = new FormData();
    upstreamForm.set("file", file, file.name);
    for (const name of outboundSaveFieldNames) {
      upstreamForm.set(name, parsedFields.data[name]);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    try {
      const upstreamResponse = await forwardUpstream({
        path: "/api/blade-order/schedule/outbound/save",
        method: "POST",
        headers: {
          accept: "application/json, text/plain, */*",
          "blade-auth": bladeAuth,
          "blade-requested-with": "BladeHttpRequest",
          ...(tenantId ? { "tenant-id": tenantId } : {}),
        },
        body: upstreamForm,
        signal: controller.signal,
        // 必须使用当前登录会话，不回退到通用服务 Authorization。
        authorization: "",
      });

      return new Response(upstreamResponse.body, {
        status: upstreamResponse.status,
        headers: selectResponseHeaders(upstreamResponse.headers),
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return c.json({ error: "The upstream outbound save request timed out." }, 504);
    }
    const message = error instanceof Error ? error.message : "Outbound save request failed.";
    return c.json({ error: message }, 502);
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
