export type LoginInput = {
  tenantId: string;
  username: string;
  password: string;
};

export type AuthenticatedUser = {
  tenantId: string;
  username: string;
  displayName: string;
  avatar?: string;
  roleName?: string;
  companyCode?: string;
  edition?: string;
};

/** Authentication context forwarded only in HTTP headers for an MCP-backed chat request. */
export type McpSessionInput = {
  bladeAuth: string;
  tenantId: string;
};

/** Non-secret endpoints used by the packaged desktop client. */
export type ServiceEndpoints = {
  mastraServerUrl: string;
  portmaxApiUrl: string;
};

export type LoginResult =
  | {
      success: true;
      user: AuthenticatedUser;
    }
  | {
      success: false;
      message: string;
    };

export type OutboundTemplateDownloadResult =
  | { status: "saved"; filename: string }
  | { status: "cancelled" }
  | { status: "failed"; message: string };

/** The only non-secret payload the renderer may send to explicitly save a completed appointment. */
export type OutboundAppointmentSaveInput = {
  file: {
    name: string;
    type: string;
    bytes: ArrayBuffer;
  };
  warehouseName: string;
  source: string;
  serviceNo: string;
  deliveryLocation: string;
  type: "跨境" | "本土";
  estimatedAppointmentTime: string;
  remark: string;
  globalUserId: string;
};

export type OutboundAppointmentSaveResult =
  | { success: true; message: string }
  | { success: false; message: string; status?: number };

export type DesktopApi = {
  auth: {
    login: (input: LoginInput) => Promise<LoginResult>;
    restoreSession: () => Promise<AuthenticatedUser | null>;
    getMcpSessionInput: () => Promise<McpSessionInput | null>;
    logout: () => Promise<void>;
  };
  server: {
    getEndpoints: () => Promise<ServiceEndpoints | null>;
    getChatProxyUrl: () => Promise<string | null>;
  };
  appointment: {
    downloadOutboundTemplate: (url: string) => Promise<OutboundTemplateDownloadResult>;
    saveOutboundSchedule: (input: OutboundAppointmentSaveInput) => Promise<OutboundAppointmentSaveResult>;
  };
};
