import { contextBridge, ipcRenderer } from "electron";
import type { DesktopApi, LoginInput, LoginResult } from "../shared/auth";

const api: DesktopApi = {
  auth: {
    login: (input: LoginInput): Promise<LoginResult> => ipcRenderer.invoke("auth:login", input),
  },
};

contextBridge.exposeInMainWorld("api", api);
