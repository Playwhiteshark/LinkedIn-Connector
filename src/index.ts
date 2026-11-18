import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { McpServer } from "@modelcontextprotocol/server";
import { createMcpHandler, getMcpAuthContext } from "agents/mcp/server";

import { authHandler, type GrantProps } from "./auth-handler.ts";
import { registerTools } from "./tools.ts";

const DAY_SECONDS = 24 * 3600;

function createServer(env: Env): McpServer {
  const server = new McpServer(
    { name: "linkedin-connector", version: "0.1.0" },
    {
      instructions: [
        "LinkedIn Connector acts on the user's own LinkedIn account through LinkedIn's official API.",
        "It can publish and delete the user's posts. Publishing is public and immediate:",
        "always draft first, show the user the exact final post, and publish only after explicit approval.",
        "It cannot edit profile fields or read the feed, comments or analytics.",
      ].join(" "),
    },
  );
  registerTools(server, env, currentProps);
  return server;
}

function currentProps(): GrantProps | null {
  const props = getMcpAuthContext()?.props as Partial<GrantProps> | undefined;
  if (!props || typeof props.sub !== "string" || typeof props.accessToken !== "string") return null;
  return props as GrantProps;
}

const mcpApiHandler = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return await createMcpHandler(() => createServer(env))(request, env, ctx);
  },
};

const provider = new OAuthProvider<Env>({
  apiRoute: "/mcp",
  apiHandler: mcpApiHandler as never,
  defaultHandler: authHandler as never,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  scopesSupported: ["linkedin"],
  // Lets Claude use its published client identity (CIMD) instead of dynamic registration.
  clientIdMetadataDocumentEnabled: true,
  accessTokenTTL: 3600,
  // LinkedIn self-serve access tokens last 60 days and cannot be refreshed, so a longer grant is useless.
  refreshTokenTTL: 60 * DAY_SECONDS,
});

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return provider.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
