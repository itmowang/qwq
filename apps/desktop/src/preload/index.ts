import { contextBridge, ipcRenderer } from "electron";
import type {
  AuthenticatedUser,
  DesktopApi,
  LoginInput,
  LoginResult,
  McpSessionInput,
  OutboundPlanCreateInput,
  OutboundPlanCreateResult,
  OutboundPlanUploadInput,
  OutboundPlanUploadResult,
  OutboundTemplateDownloadResult,
  ServiceEndpoints,
  TodoCountsResult,
  TodoListResult,
  TodoTimeState,
  TaskUrlOpenResult,
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
    uploadOutboundPlan: (input: OutboundPlanUploadInput): Promise<OutboundPlanUploadResult> => ipcRenderer.invoke("appointment:upload-outbound-plan", input),
    createOutboundPlan: (input: OutboundPlanCreateInput): Promise<OutboundPlanCreateResult> => ipcRenderer.invoke("appointment:create-outbound-plan", input),
  },
  tasks: {
    getCounts: (): Promise<TodoCountsResult> => ipcRenderer.invoke("tasks:get-counts"),
    getList: (timeState: TodoTimeState): Promise<TodoListResult> => ipcRenderer.invoke("tasks:get-list", timeState),
    openUrl: (url: string): Promise<TaskUrlOpenResult> => ipcRenderer.invoke("tasks:open-url", url),
  },
};

contextBridge.exposeInMainWorld("api", api);
