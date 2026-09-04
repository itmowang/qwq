import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { forwardUpstream } from "../http/proxy.js";

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

function getOutboundScheduleBladeAuth(): string {
  const bladeAuth = process.env.PORTMAX_OUTBOUND_SCHEDULE_BLADE_AUTH?.trim();

  if (!bladeAuth) {
    throw new Error("发起出库计划请求前必须配置 PORTMAX_OUTBOUND_SCHEDULE_BLADE_AUTH。");
  }

  return bladeAuth;
}

export function createMcpTransport() {
  const server = new McpServer({ name: "portmax_api", version: "0.1.0" });

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
        const upstreamResponse = await forwardUpstream({
          path: "/api/blade-order/schedule/outbound/page",
          method: "POST",
          headers: {
            accept: "application/json, text/plain, */*",
            "blade-auth": getOutboundScheduleBladeAuth(),
            "blade-requested-with": "BladeHttpRequest",
            "content-type": "application/json",
          },
          body: JSON.stringify({ current, size, filter, selectType }),
          // 该接口使用 Blade-Auth，不使用通用 Authorization 请求头。
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
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  return { server, transport };
}
