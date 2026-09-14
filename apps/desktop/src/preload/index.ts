import { contextBridge, ipcRenderer } from "electron";
import type {
  AuthenticatedUser,
  DesktopApi,
  LoginInput,
  LoginResult,
  McpSessionInput,
  OutboundAppointmentSaveInput,
  OutboundAppointmentSaveResult,
  OutboundTemplateDownloadResult,
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
    getChatProxyUrl: (): Promise<string | null> => ipcRenderer.invoke("server:get-chat-proxy-url"),
  },
  appointment: {
    downloadOutboundTemplate: (url: string): Promise<OutboundTemplateDownloadResult> => ipcRenderer.invoke("appointment:download-outbound-template", url),
    saveOutboundSchedule: (input: OutboundAppointmentSaveInput): Promise<OutboundAppointmentSaveResult> => ipcRenderer.invoke("appointment:save-outbound-schedule", input),
  },
};

contextBridge.exposeInMainWorld("api", api);
