# Mastra + Portmax pnpm Monorepo

一个 pnpm + TypeScript 模板，包含独立的 Mastra 初始化项目和安全的 HTTP/MCP 转发项目。

## 结构

```text
apps/
  client/        # Mastra Agent、Studio 与 Electron 聊天 API
  desktop/       # Electron + React 桌面聊天客户端
  portmax_api/   # Hono HTTP 代理 + Streamable HTTP MCP 服务
```

## 安装与检查

```bash
pnpm install
pnpm check
pnpm build
```

## `client`（Mastra CLI + Studio）

`client` 已采用由 `pnpm create mastra@latest` 生成的项目约定：Mastra 配置位于 `src/mastra/`，入口为 `src/mastra/index.ts`，agent 和工具按功能拆分在 `agents/`、`tools/` 下。旧的自定义 HTTP 聊天页已移除，改用 Mastra Studio 作为内置的管理与调试界面。

复制 `apps/client/.env.example` 为 `apps/client/.env`，配置 `MASTRA_MODEL` 和对应模型供应商的凭据，然后运行：

```bash
pnpm dev:client
```

打开 [http://localhost:4111](http://localhost:4111) 进入 Mastra Studio，可直接测试 `portmax-assistant`、查看工具调用、API、trace 与日志。CLI 也会在同一地址暴露 API 文档。

如需新建独立的 Mastra 项目，直接运行：

```bash
pnpm create mastra@latest
```

默认模型为 OpenAI，因此需要在 `apps/client/.env` 设置 `OPENAI_API_KEY`。

## `portmax_api`（Hono + MCP）

复制 `apps/portmax_api/.env.example` 为 `apps/portmax_api/.env`，将 `PORTMAX_UPSTREAM_BASE_URL` 设为受信任的上游 API 根地址。服务不会接受调用方指定的完整 URL，因此避免开放代理/SSRF 风险。

```bash
pnpm dev:portmax
```

- `GET /health`：健康检查与上游配置状态。
- `ANY /proxy/*`：把请求转发到配置的上游。例如 `/proxy/v1/users?limit=10` 会请求上游的 `/v1/users?limit=10`。
- `GET|POST|DELETE /mcp`：基于 Streamable HTTP 的 MCP 端点，提供 `request_upstream` 工具。该工具同样只接受上游相对路径。

使用生产环境前，应在反向代理或 Hono 中加入身份认证、请求限流、审计日志和更细粒度的路径白名单。
