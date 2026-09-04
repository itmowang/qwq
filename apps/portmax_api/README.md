# portmax_api

Hono 服务将受信任上游的 HTTP 接口同时暴露为普通代理路由与 MCP Tool。

配置 `PORTMAX_UPSTREAM_BASE_URL` 后：

- HTTP: `GET /proxy/path/on/upstream`
- MCP: `POST /mcp`，调用工具 `request_upstream`
- Blade OAuth 密码登录：`POST /auth/token`，`Content-Type: application/x-www-form-urlencoded`

`/auth/token` 接受 `tenantId`、`username`、`password`，可选 `scope`（默认 `all`）与 `type`（默认 `account`）。它只会请求固定的 `/api/blade-auth/oauth/token` 上游路径，并从 `PORTMAX_BLADE_OAUTH_AUTHORIZATION` 注入 Blade OAuth Basic 客户端凭据；请勿将该凭据或用户密码提交到仓库。

服务仅允许相对路径，且最终 URL 必须与配置上游同源。不要把未经校验的完整 URL 传给代理层。
