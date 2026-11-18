import { AuthorizationError, type AuthRequest, type OAuthHelpers } from "@cloudflare/workers-oauth-provider";

import { authorizationUrl, exchangeCode, getUserInfo, LinkedInError } from "./linkedin-api.ts";
import { consentPage, escapeHtml, page } from "./pages.ts";

/** Props stored (encrypted) with each MCP grant and exposed to tool calls. */
export type GrantProps = {
  sub: string;
  name: string;
  accessToken: string;
  /** ms epoch when the LinkedIn access token expires (LinkedIn self-serve tokens last 60 days, no refresh). */
  expiresAt: number;
  scope: string;
};

const STATE_TTL_SECONDS = 600;
const STATE_COOKIE = "__Host-li_state";

type PendingLogin = { oauthReq: AuthRequest; clientName: string; consented: boolean };

export const authHandler: ExportedHandler<Env> = {
  async fetch(request, env) {
    const url = new URL(request.url);
    switch (url.pathname) {
      case "/":
        return page(
          "LinkedIn Connector",
          `<p>Private remote MCP server that lets the owner's AI assistants post to their own LinkedIn account via LinkedIn's official API.</p>
<p>MCP endpoint: <code>${escapeHtml(url.origin)}/mcp</code></p>`,
        );
      case "/healthz":
        return Response.json({ ok: true, service: "linkedin-connector" }, { headers: { "Cache-Control": "no-store" } });
      case "/authorize":
        return request.method === "POST" ? startLinkedInLogin(request, env, url) : showConsent(request, env);
      case "/callback":
        return finishLinkedInLogin(request, env, url);
      default:
        return new Response("Not found", { status: 404 });
    }
  },
};

async function showConsent(request: Request, env: Env): Promise<Response> {
  const parsed = await parseAuthRequest(request, env.OAUTH_PROVIDER);
  if (parsed instanceof Response) return parsed;
  const client = await env.OAUTH_PROVIDER.lookupClient(parsed.clientId);
  if (!client) return new Response("Unknown OAuth client", { status: 400 });
  const clientName = client.clientName ?? "An MCP client";

  const stateId = randomToken();
  const pending: PendingLogin = { oauthReq: parsed, clientName, consented: false };
  await env.OAUTH_KV.put(`login:${stateId}`, JSON.stringify(pending), { expirationTtl: STATE_TTL_SECONDS });

  // Bind the login to this browser: the callback only succeeds in the browser that saw the consent page.
  return withCookie(
    consentPage(clientName, parsed.redirectUri, stateId),
    `${STATE_COOKIE}=${await sha256(stateId)}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${STATE_TTL_SECONDS}`,
  );
}

async function startLinkedInLogin(request: Request, env: Env, url: URL): Promise<Response> {
  const form = await request.formData();
  const stateId = form.get("state_id");
  if (typeof stateId !== "string" || !(await cookieMatches(request, stateId))) {
    return page("Login expired", "<p>Start the connection again from your assistant.</p>", 400);
  }
  const raw = await env.OAUTH_KV.get(`login:${stateId}`);
  if (!raw) return page("Login expired", "<p>Start the connection again from your assistant.</p>", 400);
  const pending = JSON.parse(raw) as PendingLogin;
  pending.consented = true;
  await env.OAUTH_KV.put(`login:${stateId}`, JSON.stringify(pending), { expirationTtl: STATE_TTL_SECONDS });
  return Response.redirect(authorizationUrl(env.LINKEDIN_CLIENT_ID, `${url.origin}/callback`, stateId), 302);
}

async function finishLinkedInLogin(request: Request, env: Env, url: URL): Promise<Response> {
  const stateId = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  const liError = url.searchParams.get("error");
  if (!stateId || !(await cookieMatches(request, stateId))) {
    return page("Login expired", "<p>Start the connection again from your assistant.</p>", 400);
  }
  const raw = await env.OAUTH_KV.get(`login:${stateId}`);
  await env.OAUTH_KV.delete(`login:${stateId}`);
  if (!raw) return page("Login expired", "<p>Start the connection again from your assistant.</p>", 400);
  const pending = JSON.parse(raw) as PendingLogin;
  if (!pending.consented) return page("Login expired", "<p>Start the connection again from your assistant.</p>", 400);

  if (liError || !code) {
    const desc = url.searchParams.get("error_description") ?? liError ?? "No authorization code returned.";
    return clearCookie(page("LinkedIn sign-in was not completed", `<p>${escapeHtml(desc)}</p>`, 400));
  }

  let props: GrantProps;
  try {
    const token = await exchangeCode(env, code, `${url.origin}/callback`);
    const me = await getUserInfo(token.accessToken);
    if (!env.ALLOWED_LINKEDIN_SUB || me.sub !== env.ALLOWED_LINKEDIN_SUB) {
      const hint = env.ALLOWED_LINKEDIN_SUB
        ? "<p>This connector belongs to a different LinkedIn member.</p>"
        : `<p>The connector owner isn't configured yet. If this is your connector, set the Worker secret <code>ALLOWED_LINKEDIN_SUB</code> to your LinkedIn member id:</p><p><code>${escapeHtml(me.sub)}</code></p>`;
      return clearCookie(page("Not allowed", hint, 403));
    }
    props = {
      sub: me.sub,
      name: me.name ?? [me.given_name, me.family_name].filter(Boolean).join(" "),
      accessToken: token.accessToken,
      expiresAt: token.expiresAt,
      scope: token.scope,
    };
  } catch (error) {
    const msg = error instanceof LinkedInError ? error.message : "Unexpected error talking to LinkedIn.";
    return clearCookie(page("LinkedIn sign-in failed", `<p>${escapeHtml(msg)}</p>`, 502));
  }

  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: pending.oauthReq,
    userId: props.sub,
    metadata: { clientName: pending.clientName, linkedinName: props.name },
    scope: pending.oauthReq.scope,
    props,
  });
  return clearCookie(Response.redirect(redirectTo, 302));
}

async function parseAuthRequest(request: Request, oauth: OAuthHelpers): Promise<AuthRequest | Response> {
  try {
    return await oauth.parseAuthRequest(request);
  } catch (error) {
    if (!(error instanceof AuthorizationError)) throw error;
    if (!error.redirectUri) return new Response(error.description, { status: 400 });
    const redirect = new URL(error.redirectUri);
    redirect.searchParams.set("error", error.code);
    redirect.searchParams.set("error_description", error.description);
    if (error.state) redirect.searchParams.set("state", error.state);
    return Response.redirect(redirect.toString(), 302);
  }
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function cookieMatches(request: Request, stateId: string): Promise<boolean> {
  const cookies = request.headers.get("Cookie") ?? "";
  const value = cookies.split(/;\s*/).find((c) => c.startsWith(`${STATE_COOKIE}=`))?.slice(STATE_COOKIE.length + 1);
  if (!value) return false;
  const expected = await sha256(stateId);
  if (value.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < value.length; i++) diff |= value.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function withCookie(response: Response, cookie: string): Response {
  const res = new Response(response.body, response);
  res.headers.append("Set-Cookie", cookie);
  return res;
}

function clearCookie(response: Response): Response {
  return withCookie(response, `${STATE_COOKIE}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`);
}
