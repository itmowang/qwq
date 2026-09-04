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
    logout: () => Promise<void>;
  };
};
