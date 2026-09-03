import { serve } from "@hono/node-server";
import { app } from "./app.js";

const port = Number(process.env.PORT ?? 3001);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`portmax_api listening on http://localhost:${info.port}`);
  console.log("MCP endpoint: /mcp | HTTP proxy endpoint: /proxy/* | Health: /health");
});
