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
