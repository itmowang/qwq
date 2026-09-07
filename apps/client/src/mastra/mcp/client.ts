import "dotenv/config";
import { MCPClient } from "@mastra/mcp";

const portmaxMcpUrl = new URL(process.env.PORTMAX_MCP_URL ?? "http://127.0.0.1:3001/mcp");

export const mcpClient = new MCPClient({
  id: "portmax-mcp-client",
  servers: {
    portmax: {
      url: portmaxMcpUrl,
      // 将 MCP 出站请求限定在配置的 Portmax 服务，避免工具连接到其他主机。
      allowedHosts: [portmaxMcpUrl.host],
      fetch: async (url, init, requestContext) => {
        const method = (init?.method ?? "GET").toUpperCase();
        // Portmax 不使用服务端推送的独立 GET 流，阻止 SDK 对该流进行重连。
        if (method === "GET") {
          return new Response(null, { status: 405, statusText: "Method Not Allowed" });
        }

        const headers = new Headers(init?.headers);
        const bladeAuth = requestContext?.get("portmax-blade-auth");
        const tenantId = requestContext?.get("portmax-tenant-id");
        if (typeof bladeAuth === "string" && bladeAuth.trim()) {
          headers.set("x-portmax-blade-auth", bladeAuth);
        }
        if (typeof tenantId === "string" && tenantId.trim()) {
          headers.set("x-portmax-tenant-id", tenantId);
        }

        return globalThis.fetch(url, { ...init, headers, redirect: "error" });
      },
    },
  },
});

// The same remote tools are shared by the Agent and the 4111 MCP server.
// This avoids exposing a different tool set through each integration surface.
export const portmaxTools = await mcpClient.listTools();
