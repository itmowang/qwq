import { createHash } from "crypto";
import { readFile, unlink, writeFile } from "fs/promises";
import { join } from "path";
import { app, BrowserWindow, ipcMain, Menu, safeStorage } from "electron";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import icon from "../../resources/icon.png?asset";
import type { AuthenticatedUser, LoginInput, LoginResult } from "../shared/auth";

const defaultAuthServerUrl = "http://localhost:3001";
const sessionFileName = "portmax-session.bin";

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
  const baseUrl = process.env.PORTMAX_API_URL ?? defaultAuthServerUrl;
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

async function restoreSession(): Promise<AuthenticatedUser | null> {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;

    const encryptedSession = await readFile(sessionFilePath());
    const parsed: unknown = JSON.parse(safeStorage.decryptString(encryptedSession));

    if (!isPersistedSession(parsed) || parsed.expiresAt <= Date.now()) {
      await clearSavedSession();
      return null;
    }

    return parsed.user;
  } catch {
    await clearSavedSession().catch(() => undefined);
    return null;
  }
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
        message: "认证代理尚未配置 OAuth 客户端凭据。请设置 PORTMAX_BLADE_OAUTH_AUTHORIZATION 后重启 portmax_api。",
      };
    }
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
    },
  });

  mainWindow.on("ready-to-show", () => mainWindow.show());
  mainWindow.setMenuBarVisibility(false);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

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

  ipcMain.handle("auth:logout", async (event) => {
    if (event.sender !== mainWindow.webContents) return;
    await clearSavedSession();
  });

  mainWindow.on("closed", () => {
    ipcMain.removeHandler("auth:login");
    ipcMain.removeHandler("auth:restore-session");
    ipcMain.removeHandler("auth:logout");
  });

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId("com.portmax.desktop");
  Menu.setApplicationMenu(null);

  app.on("browser-window-created", (_, window) => optimizer.watchWindowShortcuts(window));
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
