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

export type LoginResult =
  | {
      success: true;
      user: AuthenticatedUser;
    }
  | {
      success: false;
      message: string;
    };

export type DesktopApi = {
  auth: {
    login: (input: LoginInput) => Promise<LoginResult>;
    restoreSession: () => Promise<AuthenticatedUser | null>;
    getMcpSessionInput: () => Promise<McpSessionInput | null>;
    logout: () => Promise<void>;
  };
};
