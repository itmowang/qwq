import { contextBridge, ipcRenderer } from "electron";
import type {
  AuthenticatedUser,
  DesktopApi,
  LoginInput,
  LoginResult,
  McpSessionInput,
  ServiceEndpoints,
} from "../shared/auth";

const api: DesktopApi = {
  auth: {
    login: (input: LoginInput): Promise<LoginResult> => ipcRenderer.invoke("auth:login", input),
    restoreSession: (): Promise<AuthenticatedUser | null> => ipcRenderer.invoke("auth:restore-session"),
    getMcpSessionInput: (): Promise<McpSessionInput | null> => ipcRenderer.invoke("auth:get-mcp-session-input"),
    logout: (): Promise<void> => ipcRenderer.invoke("auth:logout"),
  },
  server: {
    getEndpoints: (): Promise<ServiceEndpoints | null> => ipcRenderer.invoke("server:get-endpoints"),
  },
};

contextBridge.exposeInMainWorld("api", api);
