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
  | { success: true; user: AuthenticatedUser }
  | { success: false; message: string };

export type OutboundTemplateDownloadResult =
  | { status: "saved"; filename: string }
  | { status: "cancelled" }
  | { status: "failed"; message: string };

export type OutboundPlanSubmissionDraft = {
  warehouseName: string;
  source: string;
  serviceNo: string;
  deliveryLocation: string;
  type: "跨境" | "本土";
  estimatedAppointmentTime: string;
  remark: string;
  globalUserId: string;
};

/** The Excel bytes are used only for the immediate parsing upload. */
export type OutboundPlanUploadInput = {
  file: { name: string; type: string; bytes: ArrayBuffer };
  warehouseName: string;
};

export type OutboundPlanUploadResult =
  | { success: true; message: string; boxList: unknown[]; exceptionData: string }
  | { success: false; message: string; status?: number };

/** Creation deliberately contains no file and is always JSON-serialized by the main process. */
export type OutboundPlanCreateInput = OutboundPlanSubmissionDraft & {
  boxList: unknown[];
  exceptionData: string;
};

export type OutboundPlanCreateResult =
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
    uploadOutboundPlan: (input: OutboundPlanUploadInput) => Promise<OutboundPlanUploadResult>;
    createOutboundPlan: (input: OutboundPlanCreateInput) => Promise<OutboundPlanCreateResult>;
  };
};
