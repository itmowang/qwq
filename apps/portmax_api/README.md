# portmax_api

Hono 服务将受信任上游的 HTTP 接口同时暴露为普通代理路由与 MCP Tool。

配置 `PORTMAX_UPSTREAM_BASE_URL` 后：

- HTTP: `GET /proxy/path/on/upstream`
- MCP: `POST /mcp`，调用工具 `request_upstream`

服务仅允许相对路径，且最终 URL 必须与配置上游同源。不要把未经校验的完整 URL 传给代理层。
