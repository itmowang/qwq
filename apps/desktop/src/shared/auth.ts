export type LoginInput = {
  tenantId: string;
  username: string;
  password: string;
};

export type LoginResult =
  | {
      success: true;
      username: string;
    }
  | {
      success: false;
      message: string;
    };

export type DesktopApi = {
  auth: {
    login: (input: LoginInput) => Promise<LoginResult>;
  };
};
