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

function getBladeOAuthAuthorization(): string {
  const authorization = process.env.PORTMAX_BLADE_OAUTH_AUTHORIZATION?.trim();

  if (!authorization?.startsWith("Basic ")) {
    throw new Error("PORTMAX_BLADE_OAUTH_AUTHORIZATION must contain the Blade OAuth Basic credential.");
  }

  return authorization;
}

export const httpRoutes = new Hono();

/**
 * Blade OAuth 用户名密码登录接口。
 *
 * 对应上游 `POST /api/blade-auth/oauth/token`：固定使用 password grant，
 * 将 tenantId、username、password、scope、type 转为上游查询参数，
 * 并只从服务端环境变量注入 OAuth Basic 客户端凭据。
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
