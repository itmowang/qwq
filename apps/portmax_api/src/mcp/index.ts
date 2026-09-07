import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { forwardUpstream } from "../http/proxy.js";

export type McpSessionCredentials = {
  bladeAuth: string;
  tenantId?: string;
};

type McpTransportOptions = {
  getSessionCredentials?: () => McpSessionCredentials | undefined;
};

const requestSchema = {
  path: z.string().startsWith("/").describe("已配置上游服务中的路径及可选查询参数。"),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]).default("GET"),
  headers: z.record(z.string(), z.string()).optional(),
  body: z.unknown().optional().describe("JSON 请求体；无请求体时请省略。"),
};

const outboundSchedulePageSchema = {
  current: z.number().int().positive().describe("从 1 开始的页码。"),
  size: z.number().int().positive().describe("每页返回的记录数。"),
  filter: z
    .array(z.record(z.string(), z.unknown()))
    .default([])
    .describe("Blade 查询筛选条件，例如 [{ column, fieldType, tableName, cnName, val }]。"),
  selectType: z.number().int().default(0).describe("Blade 出库计划查询的选择类型。"),
};

const dictionarySchema = {
  code: z.string().trim().min(1).describe("Portmax 字典编码。"),
};

function getOutboundScheduleCredentials(sessionCredentials: McpSessionCredentials | undefined): McpSessionCredentials {
  const bladeAuth = sessionCredentials?.bladeAuth.trim() || process.env.PORTMAX_OUTBOUND_SCHEDULE_BLADE_AUTH?.trim();

  if (!bladeAuth) {
    throw new Error(
      "发起出库计划请求前必须在 MCP 请求中提供 X-Portmax-Blade-Auth，或配置 PORTMAX_OUTBOUND_SCHEDULE_BLADE_AUTH。",
    );
  }

  return { bladeAuth, tenantId: sessionCredentials?.tenantId };
}

export function createMcpTransport(options: McpTransportOptions = {}) {
  const server = new McpServer({ name: "portmax_api", version: "0.1.0" });
  const getDictionaryCredentials = (): McpSessionCredentials => {
    const sessionCredentials = options.getSessionCredentials?.();
    const bladeAuth = sessionCredentials?.bladeAuth.trim() || process.env.PORTMAX_DICTIONARY_BLADE_AUTH?.trim();

    if (!bladeAuth) {
      throw new Error(
        "发起字典查询前必须在 MCP 请求中提供 X-Portmax-Blade-Auth，或配置 PORTMAX_DICTIONARY_BLADE_AUTH。",
      );
    }

    return { bladeAuth, tenantId: sessionCredentials?.tenantId };
  };

  server.registerTool(
    "search_dict",
    {
      title: "查询 Portmax 字典",
      description: "根据唯一的字典编码 code 查询已配置 Portmax 上游服务的字典数据；请求路径和方法均已固定。",
      inputSchema: dictionarySchema,
    },
    async ({ code }) => {
      try {
        const credentials = getDictionaryCredentials();
        const query = new URLSearchParams({ code });
        const upstreamResponse = await forwardUpstream({
          path: `/blade-system/dict/dictionary?${query.toString()}`,
          method: "GET",
          headers: {
            accept: "application/json, text/plain, */*",
            "blade-auth": credentials.bladeAuth,
            "blade-requested-with": "BladeHttpRequest",
            ...(credentials.tenantId ? { "tenant-id": credentials.tenantId } : {}),
          },
          // 字典接口使用每个 MCP session 绑定的 Blade-Auth，不使用通用 Authorization 请求头。
          authorization: "",
        });
        const text = await upstreamResponse.text();
        const summary = JSON.stringify(
          {
            status: upstreamResponse.status,
            contentType: upstreamResponse.headers.get("content-type"),
            body: text,
          },
          null,
          2,
        );

        return {
          content: [{ type: "text", text: summary }],
          isError: !upstreamResponse.ok,
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : "字典查询失败。" }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "request_upstream",
    {
      title: "请求已配置的上游服务",
      description: "调用 PORTMAX_UPSTREAM_BASE_URL 下的 HTTP 接口，调用方无法修改目标服务的域名。",
      inputSchema: requestSchema,
    },
    async ({ path, method, headers, body }) => {
      try {
        const requestHeaders = new Headers(headers);
        const serializedBody = body === undefined ? undefined : JSON.stringify(body);
        if (serializedBody && !requestHeaders.has("content-type")) {
          requestHeaders.set("content-type", "application/json");
        }

        const upstreamResponse = await forwardUpstream({
          path,
          method,
          headers: Object.fromEntries(requestHeaders),
          body: serializedBody,
        });
        const text = await upstreamResponse.text();
        const summary = JSON.stringify(
          {
            status: upstreamResponse.status,
            contentType: upstreamResponse.headers.get("content-type"),
            body: text,
          },
          null,
          2,
        );

        return {
          content: [{ type: "text", text: summary }],
          isError: !upstreamResponse.ok,
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : "上游请求失败。" }],
          isError: true,
        };
      }
    },
  );

  server.registerTool(
    "get_outbound_schedule_page",
    {
      title: "获取出库计划分页数据",
      description: "从已配置的 Portmax 上游服务查询出库计划分页数据；请求路径和方法均已固定。",
      inputSchema: outboundSchedulePageSchema,
    },
    async ({ current, size, filter, selectType }) => {
      try {
        const credentials = getOutboundScheduleCredentials(options.getSessionCredentials?.());
        const upstreamResponse = await forwardUpstream({
          path: "/api/blade-order/schedule/outbound/page",
          method: "POST",
          headers: {
            accept: "application/json, text/plain, */*",
            "blade-auth": credentials.bladeAuth,
            "blade-requested-with": "BladeHttpRequest",
            "content-type": "application/json",
            ...(credentials.tenantId ? { "tenant-id": credentials.tenantId } : {}),
          },
          body: JSON.stringify({ current, size, filter, selectType }),
          // 该接口使用每个 MCP session 绑定的 Blade-Auth，不使用通用 Authorization 请求头。
          authorization: "",
        });
        const text = await upstreamResponse.text();
        const summary = JSON.stringify(
          {
            status: upstreamResponse.status,
            contentType: upstreamResponse.headers.get("content-type"),
            body: text,
          },
          null,
          2,
        );

        return {
          content: [{ type: "text", text: summary }],
          isError: !upstreamResponse.ok,
        };
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : "出库计划请求失败。" }],
          isError: true,
        };
      }
    },
  );

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    enableJsonResponse: true,
  });

  return { server, transport };
}
