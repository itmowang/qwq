import { contextBridge, ipcRenderer } from "electron";
import type { AuthenticatedUser, DesktopApi, LoginInput, LoginResult } from "../shared/auth";

const api: DesktopApi = {
  auth: {
    login: (input: LoginInput): Promise<LoginResult> => ipcRenderer.invoke("auth:login", input),
    restoreSession: (): Promise<AuthenticatedUser | null> => ipcRenderer.invoke("auth:restore-session"),
    logout: (): Promise<void> => ipcRenderer.invoke("auth:logout"),
  },
};

contextBridge.exposeInMainWorld("api", api);
