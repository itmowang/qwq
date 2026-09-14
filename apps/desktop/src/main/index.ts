import { createHash } from "crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "http";
import { readFile, rename, unlink, writeFile } from "fs/promises";
import { join } from "path";
import { Readable } from "stream";
import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage } from "electron";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import icon from "../../resources/icon.png?asset";
import type {
  AuthenticatedUser,
  LoginInput,
  LoginResult,
  OutboundAppointmentSaveInput,
  OutboundAppointmentSaveResult,
  OutboundTemplateDownloadResult,
  ServiceEndpoints,
} from "../shared/auth";

const endpointConfigFileName = "portmax-endpoints.json";
const defaultServiceEndpoints: ServiceEndpoints = {
  mastraServerUrl: "http://localhost:4111",
  portmaxApiUrl: "http://localhost:3001",
};
let serviceEndpoints = defaultServiceEndpoints;
let chatProxyServer: Server | null = null;
let chatProxyUrl: string | null = null;
const sessionFileName = "portmax-session.bin";
const maxChatRequestBytes = 16 * 1024 * 1024;

type PersistedSession = {
  version: 1;
  user: AuthenticatedUser;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
};

type ParsedLoginSession =
  | { session: PersistedSession }
  | { message: string };

function normalizeServiceUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;

  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function parseServiceEndpoints(value: unknown): ServiceEndpoints | null {
  if (!value || typeof value !== "object") return null;

  const config = value as Record<string, unknown>;
  const mastraServerUrl = normalizeServiceUrl(config.mastraServerUrl);
  const portmaxApiUrl = normalizeServiceUrl(config.portmaxApiUrl);

  return mastraServerUrl && portmaxApiUrl ? { mastraServerUrl, portmaxApiUrl } : null;
}

async function loadServiceEndpoints(): Promise<ServiceEndpoints> {
  const bundledConfigPath = app.isPackaged
    ? join(process.resourcesPath, endpointConfigFileName)
    : join(app.getAppPath(), "resources", endpointConfigFileName);
  const configPaths = [join(app.getPath("userData"), endpointConfigFileName), bundledConfigPath];

  for (const configPath of configPaths) {
    try {
      const config = parseServiceEndpoints(JSON.parse(await readFile(configPath, "utf8")));
      if (config) return config;
    } catch {
      // Try the next config source. User data overrides the installer default when present.
    }
  }

  return defaultServiceEndpoints;
}

function setChatProxyCors(request: IncomingMessage, response: ServerResponse): void {
  const origin = request.headers.origin;

  if (origin === "file://" || origin === "null" || origin === "http://localhost:5173") {
    response.setHeader("access-control-allow-origin", origin);
  }

  response.setHeader("access-control-allow-methods", "POST, OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type, x-portmax-blade-auth, x-portmax-tenant-id");
  response.setHeader("access-control-allow-private-network", "true");
  response.setHeader("access-control-expose-headers", "x-vercel-ai-ui-message-stream, x-portmax-chat-proxy-error");
  response.setHeader("vary", "Origin");
}

class ChatRequestTooLargeError extends Error {
  constructor() {
    super("Chat request body exceeds the 16 MiB attachment limit.");
  }
}

async function readChatRequestBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buffer.length;
    if (totalBytes > maxChatRequestBytes) throw new ChatRequestTooLargeError();
    chunks.push(buffer);
  }

  return Buffer.concat(chunks, totalBytes);
}

async function forwardChatRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
  setChatProxyCors(request, response);

  if (request.method === "OPTIONS") {
    response.writeHead(204).end();
    return;
  }

  const requestUrl = request.url;
  const isChatRequest = request.method === "POST" && requestUrl?.startsWith("/chat/");
  if (!requestUrl || !isChatRequest) {
    response.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "Not found." }));
    return;
  }

  try {
    const upstreamHeaders = new Headers();
    for (const [name, value] of Object.entries(request.headers)) {
      if (value && !["connection", "content-length", "host"].includes(name.toLowerCase())) {
        upstreamHeaders.set(name, Array.isArray(value) ? value.join(", ") : value);
      }
    }

    const requestBody = (await readChatRequestBody(request)).toString("utf8");
    const upstreamResponse = await fetch(new URL(requestUrl, serviceEndpoints.mastraServerUrl), {
      method: "POST",
      headers: upstreamHeaders,
      body: requestBody,
    });

    for (const [name, value] of upstreamResponse.headers) {
      if (!['connection', 'keep-alive', 'transfer-encoding'].includes(name.toLowerCase())) {
        response.setHeader(name, value);
      }
    }
    setChatProxyCors(request, response);
    response.writeHead(upstreamResponse.status);

    if (upstreamResponse.body) {
      Readable.fromWeb(upstreamResponse.body as never).pipe(response);
    } else {
      response.end();
    }
  } catch (error) {
    if (error instanceof ChatRequestTooLargeError) {
      response.writeHead(413, { "content-type": "application/json" }).end(JSON.stringify({
        error: "附件或聊天记录超过 16 MiB 限制。请减少附件数量或新建对话后重试。",
      }));
      return;
    }

    const detail = error instanceof Error ? error.message : "Unknown proxy error.";
    console.error("Local chat proxy request failed.", detail);
    response.setHeader("x-portmax-chat-proxy-error", detail);
    response.writeHead(502, { "content-type": "application/json" }).end(JSON.stringify({ error: "Chat service is unavailable.", detail }));
  }
}

async function startChatProxy(): Promise<string> {
  chatProxyServer = createServer((request, response) => {
    void forwardChatRequest(request, response);
  });

  await new Promise<void>((resolve, reject) => {
    chatProxyServer?.once("error", reject);
    chatProxyServer?.listen(0, "127.0.0.1", () => {
      chatProxyServer?.off("error", reject);
      resolve();
    });
  });

  const address = chatProxyServer.address();
  if (!address || typeof address === "string") throw new Error("Unable to determine the local chat proxy port.");
  return `http://127.0.0.1:${address.port}`;
}

function isLoginInput(value: unknown): value is LoginInput {
  if (!value || typeof value !== "object") return false;

  const input = value as Record<string, unknown>;
  return (
    typeof input.tenantId === "string" &&
    input.tenantId.trim().length > 0 &&
    input.tenantId.length <= 128 &&
    typeof input.username === "string" &&
    input.username.trim().length > 0 &&
    input.username.length <= 256 &&
    typeof input.password === "string" &&
    input.password.length > 0 &&
    input.password.length <= 1024
  );
}

function getAuthEndpoint(): URL {
  const baseUrl = process.env.PORTMAX_API_URL ?? serviceEndpoints.portmaxApiUrl;
  const endpoint = new URL("/auth/token", baseUrl);

  if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
    throw new Error("The authentication server must use HTTP or HTTPS.");
  }

  return endpoint;
}

function sessionFilePath(): string {
  return join(app.getPath("userData"), sessionFileName);
}

async function clearSavedSession(): Promise<void> {
  try {
    await unlink(sessionFilePath());
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function saveSession(session: PersistedSession): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Secure operating-system storage is unavailable.");
  }

  const encryptedSession = safeStorage.encryptString(JSON.stringify(session));
  await writeFile(sessionFilePath(), encryptedSession, { mode: 0o600 });
}

function isAuthenticatedUser(value: unknown): value is AuthenticatedUser {
  if (!value || typeof value !== "object") return false;

  const user = value as Record<string, unknown>;
  const optionalKeys = ["avatar", "roleName", "companyCode", "edition"];

  return (
    typeof user.tenantId === "string" &&
    user.tenantId.length > 0 &&
    typeof user.username === "string" &&
    user.username.length > 0 &&
    typeof user.displayName === "string" &&
    user.displayName.length > 0 &&
    optionalKeys.every((key) => user[key] === undefined || typeof user[key] === "string")
  );
}

function isPersistedSession(value: unknown): value is PersistedSession {
  if (!value || typeof value !== "object") return false;

  const session = value as Record<string, unknown>;
  return (
    session.version === 1 &&
    isAuthenticatedUser(session.user) &&
    typeof session.accessToken === "string" &&
    session.accessToken.length > 0 &&
    (session.refreshToken === undefined || typeof session.refreshToken === "string") &&
    typeof session.expiresAt === "number" &&
    Number.isFinite(session.expiresAt)
  );
}

async function readValidPersistedSession(): Promise<PersistedSession | null> {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;

    const encryptedSession = await readFile(sessionFilePath());
    const parsed: unknown = JSON.parse(safeStorage.decryptString(encryptedSession));
    if (!isPersistedSession(parsed) || parsed.expiresAt <= Date.now()) {
      await clearSavedSession();
      return null;
    }
    return parsed;
  } catch {
    await clearSavedSession().catch(() => undefined);
    return null;
  }
}

async function restoreSession(): Promise<AuthenticatedUser | null> {
  return (await readValidPersistedSession())?.user ?? null;
}

async function authenticationFailure(response: Response): Promise<LoginResult> {
  if (response.status === 400 || response.status === 415) {
    return { success: false, message: "登录信息格式不正确，请检查后重试。" };
  }

  if (response.status === 401 || response.status === 403) {
    return { success: false, message: "租户、用户名或密码不正确。" };
  }

  if (response.status === 502) {
    const payload: unknown = await response.json().catch(() => null);
    if (
      payload &&
      typeof payload === "object" &&
      "error" in payload &&
      typeof payload.error === "string" &&
      payload.error.includes("PORTMAX_BLADE_OAUTH_AUTHORIZATION")
    ) {
      return {
        success: false,
        message: "登录代理缺少上游 Basic 客户端凭据，请配置 PORTMAX_BLADE_OAUTH_AUTHORIZATION 后重启 portmax_api。",
      };
    }

    return { success: false, message: "登录代理的上游暂时不可用，请稍后重试。" };
  }

  return { success: false, message: "认证服务的上游暂时不可用，请稍后重试。" };
}

function responseString(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function safeAvatarUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;

  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function parseLoginSession(payload: unknown, input: LoginInput): ParsedLoginSession {
  if (!payload || typeof payload !== "object") {
    return { message: "登录服务未返回可识别的用户信息。" };
  }

  const profile = payload as Record<string, unknown>;
  const accessToken = responseString(profile, "access_token");
  const expiresIn = profile.expires_in;

  if (!accessToken || typeof expiresIn !== "number" || !Number.isFinite(expiresIn) || expiresIn <= 0) {
    return { message: "登录服务未返回可用的会话凭据。" };
  }

  const username = responseString(profile, "user_name") ?? responseString(profile, "account") ?? input.username.trim();
  const displayName = responseString(profile, "real_name") ?? responseString(profile, "nick_name") ?? username;

  return {
    session: {
      version: 1,
      accessToken,
      refreshToken: responseString(profile, "refresh_token"),
      expiresAt: Date.now() + Math.floor(expiresIn * 1000),
      user: {
        tenantId: responseString(profile, "tenant_id") ?? input.tenantId.trim(),
        username,
        displayName,
        avatar: safeAvatarUrl(responseString(profile, "avatar")),
        roleName: responseString(profile, "role_name"),
        companyCode: responseString(profile, "global_company_code"),
        edition: responseString(profile, "edition"),
      },
    },
  };
}

async function login(input: LoginInput): Promise<LoginResult> {
  if (!isLoginInput(input)) {
    return { success: false, message: "请填写租户 ID、用户名和密码。" };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(getAuthEndpoint(), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        tenantId: input.tenantId.trim(),
        username: input.username.trim(),
        password: createHash("md5").update(input.password, "utf8").digest("hex"),
      }),
      signal: controller.signal,
    });

    if (!response.ok) return authenticationFailure(response);

    const payload: unknown = await response.json().catch(() => null);
    const parsed = parseLoginSession(payload, input);
    if ("message" in parsed) return { success: false, message: parsed.message };

    try {
      await saveSession(parsed.session);
    } catch {
      return { success: false, message: "登录成功，但无法将会话安全地保存到本机。" };
    }

    return { success: true, user: parsed.session.user };
  } catch {
    return { success: false, message: "无法连接登录服务，请确认本地服务已启动。" };
  } finally {
    clearTimeout(timeout);
  }
}

const outboundTemplateOrigin = "https://portmax-v2-prod.oss-cn-hangzhou.aliyuncs.com";
const maxOutboundTemplateBytes = 8 * 1024 * 1024;

function trustedOutboundTemplateUrl(value: unknown): URL | null {
  if (typeof value !== "string" || value.length === 0 || value.length > 2_000) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.origin === outboundTemplateOrigin && !url.username && !url.password
      ? url
      : null;
  } catch {
    return null;
  }
}

async function downloadOutboundTemplate(mainWindow: BrowserWindow, rawUrl: unknown): Promise<OutboundTemplateDownloadResult> {
  const url = trustedOutboundTemplateUrl(rawUrl);
  if (!url) return { status: "failed", message: "模板下载地址无效或不受信任。" };

  const saveResult = await dialog.showSaveDialog(mainWindow, {
    title: "另存出库附件模板",
    defaultPath: "outbound-box-list.xlsx",
    filters: [{ name: "Excel 模板", extensions: ["xlsx", "xls"] }],
  });
  if (saveResult.canceled || !saveResult.filePath) return { status: "cancelled" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  const temporaryPath = `${saveResult.filePath}.part-${process.pid}-${Date.now()}`;
  try {
    const response = await fetch(url, { redirect: "error", signal: controller.signal });
    if (!response.ok) return { status: "failed", message: `模板下载失败（HTTP ${response.status}）。` };

    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > maxOutboundTemplateBytes) {
      return { status: "failed", message: "模板文件超过 8 MiB 限制。" };
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length === 0) return { status: "failed", message: "模板文件为空。" };
    if (bytes.length > maxOutboundTemplateBytes) return { status: "failed", message: "模板文件超过 8 MiB 限制。" };

    await writeFile(temporaryPath, bytes, { mode: 0o600 });
    await rename(temporaryPath, saveResult.filePath);
    return { status: "saved", filename: "outbound-box-list.xlsx" };
  } catch (error) {
    return { status: "failed", message: error instanceof Error && error.name === "AbortError" ? "模板下载超时，请重试。" : "模板下载或保存失败，请重试。" };
  } finally {
    clearTimeout(timeout);
    await unlink(temporaryPath).catch(() => undefined);
  }
}

const maxOutboundAppointmentAttachmentBytes = 4 * 1024 * 1024;
const allowedOutboundAppointmentFileTypes = new Set([
  "",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedString(value: unknown, minimumLength: number, maximumLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text.length >= minimumLength && text.length <= maximumLength ? text : null;
}

function validEstimatedAppointmentTime(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return false;
  const [date, time] = value.split(" ");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute, second] = time.split(":").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day
    && parsed.getUTCHours() === hour
    && parsed.getUTCMinutes() === minute
    && parsed.getUTCSeconds() === second;
}

function parseOutboundAppointmentSaveInput(value: unknown): OutboundAppointmentSaveInput | null {
  if (!isRecord(value)) return null;
  const expectedKeys = new Set([
    "file", "warehouseName", "source", "serviceNo", "deliveryLocation",
    "type", "estimatedAppointmentTime", "remark", "globalUserId",
  ]);
  if (Object.keys(value).length !== expectedKeys.size || Object.keys(value).some((key) => !expectedKeys.has(key))) return null;
  if (!isRecord(value.file)) return null;

  const name = boundedString(value.file.name, 1, 255);
  const type = typeof value.file.type === "string" ? value.file.type.toLowerCase() : null;
  const bytes = value.file.bytes;
  const warehouseName = boundedString(value.warehouseName, 1, 240);
  const source = boundedString(value.source, 0, 240);
  const serviceNo = boundedString(value.serviceNo, 1, 120);
  const deliveryLocation = boundedString(value.deliveryLocation, 1, 120);
  const remark = boundedString(value.remark, 0, 1_000);
  const globalUserId = boundedString(value.globalUserId, 1, 120);
  const estimatedAppointmentTime = boundedString(value.estimatedAppointmentTime, 19, 19);

  if (!name || /[\\/\u0000-\u001f]/.test(name) || !/\.(xlsx|xls)$/i.test(name)
    || type === null || !allowedOutboundAppointmentFileTypes.has(type)
    || !(bytes instanceof ArrayBuffer) || bytes.byteLength === 0 || bytes.byteLength > maxOutboundAppointmentAttachmentBytes
    || !warehouseName || source === null || !serviceNo || !deliveryLocation || remark === null || !globalUserId
    || (value.type !== "跨境" && value.type !== "本土")
    || !estimatedAppointmentTime || !validEstimatedAppointmentTime(estimatedAppointmentTime)) {
    return null;
  }

  return {
    file: { name, type, bytes },
    warehouseName,
    source,
    serviceNo,
    deliveryLocation,
    type: value.type,
    estimatedAppointmentTime,
    remark,
    globalUserId,
  };
}

function saveResponseMessage(payload: unknown, fallback: string): string {
  if (!isRecord(payload)) return fallback;
  for (const key of ["msg", "message", "error"]) {
    const message = payload[key];
    if (typeof message === "string" && message.trim()) return message.trim().slice(0, 500);
  }
  return fallback;
}

async function saveOutboundAppointment(rawInput: unknown): Promise<OutboundAppointmentSaveResult> {
  const input = parseOutboundAppointmentSaveInput(rawInput);
  if (!input) return { success: false, message: "预约保存数据无效。请重新选择附件并从当前预约流程继续。" };

  const session = await readValidPersistedSession();
  if (!session) return { success: false, message: "登录会话已失效，请重新登录后再保存。" };

  let endpoint: URL;
  try {
    endpoint = new URL("/outbound-schedule/save", serviceEndpoints.portmaxApiUrl);
  } catch {
    return { success: false, message: "本地预约保存服务地址无效。" };
  }

  const form = new FormData();
  form.set("file", new Blob([input.file.bytes], { type: input.file.type }), input.file.name);
  form.set("warehouseName", input.warehouseName);
  form.set("source", input.source);
  form.set("serviceNo", input.serviceNo);
  form.set("deliveryLocation", input.deliveryLocation);
  form.set("type", input.type);
  form.set("estimatedAppointmentTime", input.estimatedAppointmentTime);
  form.set("remark", input.remark);
  form.set("globalUserId", input.globalUserId);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 35_000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json, text/plain, */*",
        "x-portmax-blade-auth": session.accessToken,
        "x-portmax-tenant-id": session.user.tenantId,
      },
      body: form,
      redirect: "error",
      signal: controller.signal,
    });
    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      // A successful upstream save may return a plain-text acknowledgement.
    }
    const isBusinessFailure = isRecord(payload)
      && (payload.success === false || (typeof payload.code === "number" && payload.code >= 400));
    if (!response.ok || isBusinessFailure) {
      return {
        success: false,
        status: response.status,
        message: saveResponseMessage(payload, `预约保存失败（HTTP ${response.status}）。`),
      };
    }
    return { success: true, message: saveResponseMessage(payload, "预约单已提交并获得上游确认。") };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return { success: false, message: "保存请求超时，结果未确认。请先在 Portmax 查询是否已创建；不要自动重试。" };
    }
    return { success: false, message: "保存请求未得到确认结果。请先在 Portmax 查询是否已创建；不要自动重试。" };
  } finally {
    clearTimeout(timeout);
  }
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1040,
    height: 760,
    minWidth: 640,
    minHeight: 540,
    show: false,
    backgroundColor: "#f7f9fc",
    autoHideMenuBar: true,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: "#f7f9fc",
      symbolColor: "#24364a",
      height: 32,
    },
    ...(process.platform === "linux" ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: true,
    },
  });

  mainWindow.on("ready-to-show", () => mainWindow.show());
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("before-input-event", (event, input) => {
    const isDevToolsShortcut = input.key === "F12" || (input.control && input.shift && input.key.toLowerCase() === "i");
    if (!isDevToolsShortcut) return;

    mainWindow.webContents.toggleDevTools();
    event.preventDefault();
  });

  ipcMain.handle("auth:login", (event, input: unknown) => {
    if (event.sender !== mainWindow.webContents) {
      return { success: false, message: "无法验证登录请求来源。" } satisfies LoginResult;
    }

    return login(input as LoginInput);
  });

  ipcMain.handle("auth:restore-session", (event) => {
    if (event.sender !== mainWindow.webContents) return null;
    return restoreSession();
  });

  ipcMain.handle("auth:get-mcp-session-input", async (event) => {
    if (event.sender !== mainWindow.webContents) return null;

    const session = await readValidPersistedSession();
    return session
      ? { bladeAuth: session.accessToken, tenantId: session.user.tenantId }
      : null;
  });

  ipcMain.handle("server:get-endpoints", (event) => {
    if (event.sender !== mainWindow.webContents) return null;
    return serviceEndpoints;
  });

  ipcMain.handle("server:get-chat-proxy-url", (event) => {
    if (event.sender !== mainWindow.webContents) return null;
    return chatProxyUrl;
  });

  ipcMain.handle("appointment:download-outbound-template", async (event, rawUrl: unknown) => {
    if (event.sender !== mainWindow.webContents) {
      return { status: "failed", message: "无法验证模板下载请求来源。" } satisfies OutboundTemplateDownloadResult;
    }
    return downloadOutboundTemplate(mainWindow, rawUrl);
  });

  ipcMain.handle("appointment:save-outbound-schedule", async (event, input: unknown) => {
    if (event.sender !== mainWindow.webContents) {
      return { success: false, message: "无法验证预约保存请求来源。" } satisfies OutboundAppointmentSaveResult;
    }
    return saveOutboundAppointment(input);
  });

  ipcMain.handle("auth:logout", async (event) => {
    if (event.sender !== mainWindow.webContents) return;
    await clearSavedSession();
  });

  mainWindow.on("closed", () => {
    ipcMain.removeHandler("auth:login");
    ipcMain.removeHandler("auth:restore-session");
    ipcMain.removeHandler("auth:get-mcp-session-input");
    ipcMain.removeHandler("server:get-endpoints");
    ipcMain.removeHandler("server:get-chat-proxy-url");
    ipcMain.removeHandler("appointment:download-outbound-template");
    ipcMain.removeHandler("appointment:save-outbound-schedule");
    ipcMain.removeHandler("auth:logout");
  });

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId("com.portmax.desktop");
  Menu.setApplicationMenu(null);
  serviceEndpoints = await loadServiceEndpoints();

  try {
    chatProxyUrl = await startChatProxy();
  } catch (error) {
    console.error("Unable to start the local chat proxy.", error);
  }

  app.on("browser-window-created", (_, window) => optimizer.watchWindowShortcuts(window));
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  chatProxyServer?.close();
});
