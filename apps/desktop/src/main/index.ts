import { app, BrowserWindow, ipcMain } from "electron";
import { createHash } from "crypto";
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";
import icon from "../../resources/icon.png?asset";
import type { LoginInput, LoginResult } from "../shared/auth";

const defaultAuthServerUrl = "http://localhost:3001";

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

    return response.ok
      ? { success: true, username: input.username.trim() }
      : await authenticationFailure(response);
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
    autoHideMenuBar: true,
    ...(process.platform === "linux" ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.on("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  ipcMain.handle("auth:login", (event, input: unknown) => {
    if (event.sender !== mainWindow.webContents) {
      return { success: false, message: "无法验证登录请求来源。" } satisfies LoginResult;
    }

    return login(input as LoginInput);
  });

  mainWindow.on("closed", () => ipcMain.removeHandler("auth:login"));

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId("com.portmax.desktop");

  app.on("browser-window-created", (_, window) => optimizer.watchWindowShortcuts(window));
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
