import { createTool } from "@mastra/core/tools";
import { z } from "zod";

/** Returns a timestamp in UTC or a requested IANA time zone. */
export const getCurrentTime = createTool({
  id: "get-current-time",
  description: "Returns the current ISO timestamp.",
  inputSchema: z.object({
    timezone: z.string().optional().describe("Optional IANA timezone, for example Asia/Shanghai."),
  }),
  execute: async ({ timezone }) => {
    const now = new Date();

    if (!timezone) {
      return { isoTime: now.toISOString(), timezone: "UTC" };
    }

    try {
      return {
        isoTime: new Intl.DateTimeFormat("sv-SE", {
          dateStyle: "short",
          timeStyle: "medium",
          timeZone: timezone,
        }).format(now),
        timezone,
      };
    } catch {
      return { isoTime: now.toISOString(), timezone: "UTC", warning: `Unknown timezone: ${timezone}` };
    }
  },
});
