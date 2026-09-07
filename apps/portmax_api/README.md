# portmax_api

Hono 服务将受信任上游的 HTTP 接口同时暴露为普通代理路由与 MCP Tool。

配置 `PORTMAX_UPSTREAM_BASE_URL` 后：

- HTTP: `GET /proxy/path/on/upstream`
- MCP: `POST /mcp`，调用工具 `request_upstream`、`get_outbound_schedule_page` 或 `search_dict`
- Blade OAuth 密码登录：`POST /auth/token`，`Content-Type: application/x-www-form-urlencoded`

`get_outbound_schedule_page` 固定代理 `POST /api/blade-order/schedule/outbound/page`，输入为 `current`、`size`、可选 `filter`（Blade 条件数组）及可选 `selectType`（默认 `0`）。它使用 `PORTMAX_OUTBOUND_SCHEDULE_BLADE_AUTH` 在服务端注入 `Blade-Auth` 请求头；将 `PORTMAX_UPSTREAM_BASE_URL` 配置为目标 Portmax 服务，例如本地调试时 `http://localhost:9082`。请只在本地 `.env` 中保存令牌，绝不要提交令牌。

`search_dict` 固定代理 `GET /blade-system/dict/dictionary`，仅接受非空的 `code` 输入。它优先使用 MCP 请求头的 `X-Portmax-Blade-Auth`（及可选 `X-Portmax-Tenant-Id`）；也可在本地 `.env` 设置 `PORTMAX_DICTIONARY_BLADE_AUTH` 作为服务端后备凭据。令牌不得提交到仓库。

`/auth/token` 接受 `tenantId`、`username`、`password`，可选 `scope`（默认 `all`）与 `type`（默认 `account`）。它只会请求固定的 `/api/blade-auth/oauth/token` 上游路径，并从 `PORTMAX_BLADE_OAUTH_AUTHORIZATION` 注入 Blade OAuth Basic 客户端凭据；请勿将该凭据或用户密码提交到仓库。

服务仅允许相对路径，且最终 URL 必须与配置上游同源。不要把未经校验的完整 URL 传给代理层。
