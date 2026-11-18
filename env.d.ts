import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";

declare global {
  interface Env {
    OAUTH_KV: KVNamespace;
    OAUTH_PROVIDER: OAuthHelpers;
    LINKEDIN_CLIENT_ID: string;
    LINKEDIN_CLIENT_SECRET: string;
    /** LinkedIn OpenID `sub` of the only member allowed to connect. */
    ALLOWED_LINKEDIN_SUB: string;
    LINKEDIN_API_VERSION: string;
  }
}

export {};
