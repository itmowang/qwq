import { z } from "zod";

// name 是前端 fieldNames 的唯一必需字段；其余上游字段原样保留给表格展示。
export const warehouseSettingSchema = z
  .object({
    name: z.string().trim().min(1),
  })
  .passthrough();

const warehouseSettingsSchema = z.array(warehouseSettingSchema);

export type WarehouseSetting = z.infer<typeof warehouseSettingSchema>;

type QueryWarehouseSettingsInput = {
  warehouseName: string;
  bladeAuth: string;
  tenantId?: string;
};

function getPortmaxApiUrl(): URL {
  const configuredUrl = process.env.PORTMAX_API_URL ?? "http://127.0.0.1:3001";
  const url = new URL(configuredUrl);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("PORTMAX_API_URL must use HTTP or HTTPS.");
  }

  return url;
}

/** Accept direct arrays and the common Blade response envelopes without exposing response details in errors. */
function unwrapWarehouseSettings(payload: unknown): unknown[] | undefined {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return undefined;

  const response = payload as Record<string, unknown>;
  if (Array.isArray(response.data)) return response.data;
  if (Array.isArray(response.records)) return response.records;

  if (response.data && typeof response.data === "object") {
    const data = response.data as Record<string, unknown>;
    if (Array.isArray(data.records)) return data.records;
  }

  return undefined;
}

/** Calls the fixed, authenticated portmax_api warehouse-settings endpoint. */
export async function queryWarehouseSettingsByName({
  warehouseName,
  bladeAuth,
  tenantId,
}: QueryWarehouseSettingsInput): Promise<WarehouseSetting[]> {
  const endpoint = new URL("/warehouse-settings/by-name", getPortmaxApiUrl());
  endpoint.searchParams.set("warehouseName", warehouseName);

  const response = await fetch(endpoint, {
    headers: {
      accept: "application/json, text/plain, */*",
      "x-portmax-blade-auth": bladeAuth,
      ...(tenantId ? { "x-portmax-tenant-id": tenantId } : {}),
    },
    redirect: "error",
  });

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      typeof payload === "object" && payload !== null && "error" in payload && typeof payload.error === "string"
        ? payload.error
        : `Warehouse setting request failed with status ${response.status}.`,
    );
  }

  const settings = unwrapWarehouseSettings(payload);
  const parsed = warehouseSettingsSchema.safeParse(settings);
  if (!parsed.success) {
    throw new Error("Warehouse setting response must be an array or contain a data/records array of named warehouses.");
  }

  return parsed.data;
}
