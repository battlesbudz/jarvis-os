export const DEFAULT_OPENAI_OAUTH_REDIRECT_URI = "http://127.0.0.1:1455/auth/callback";
export const DEFAULT_CHATGPT_CODEX_OAUTH_REDIRECT_URI = "http://localhost:1455/auth/callback";

export const DEFAULT_CHATGPT_CODEX_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const DEFAULT_CHATGPT_CODEX_OAUTH_AUTHORIZATION_URL = "https://auth.openai.com/oauth/authorize";
export const DEFAULT_CHATGPT_CODEX_OAUTH_TOKEN_URL = "https://auth.openai.com/oauth/token";
export const DEFAULT_CHATGPT_CODEX_OAUTH_USERINFO_URL = "https://api.openai.com/profile";

export const DEFAULT_CHATGPT_CODEX_OAUTH_SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "api.connectors.read",
  "api.connectors.invoke",
];

export const DEFAULT_CHATGPT_CODEX_OAUTH_AUTHORIZATION_PARAMS: Record<string, string> = {
  id_token_add_organizations: "true",
  codex_cli_simplified_flow: "true",
};
