import { ElectronAPI } from "@electron-toolkit/preload";
import type { DesktopApi } from "../shared/auth";

declare global {
  interface Window {
    electron: ElectronAPI;
    api: DesktopApi;
  }
}
