# LinkedIn Connector

Private remote MCP server (Cloudflare Worker) that lets the owner's assistants (Claude, ChatGPT and other MCP clients) act on **the owner's own LinkedIn account** through LinkedIn's official API. It is not a bot account and does no scraping or automation outside LinkedIn's API terms.

- MCP endpoint: `https://linkedin-connector.playwhiteshark.workers.dev/mcp`
- Health: `https://linkedin-connector.playwhiteshark.workers.dev/healthz`

## What it can do

| Tool | Effect |
|---|---|
| `linkedin_whoami` | Show the connected member, scopes and when LinkedIn access expires |
| `linkedin_create_post` | Publish a text post, optionally with one link card or one image (JPEG/PNG/GIF, ≤ 8 MB), `PUBLIC` or `CONNECTIONS`. Requires `confirm_publish: true` |
| `linkedin_delete_post` | Delete one of the member's posts by URN. Requires `confirm_delete: true` |

`#hashtags` in post text become real hashtags; every other LinkedIn "Little Text" reserved character is escaped so the text posts exactly as written.

## What LinkedIn does not allow (self-serve apps)

These are LinkedIn API constraints, not missing features:

- **Editing profile fields** (headline, About, experience, skills, photo): no public write API. Profile editing APIs are restricted to approved partners. Do it at linkedin.com/in/me.
- **Reading the feed, your past posts, comments, reactions or analytics**: needs `r_member_social` or Community Management API access, which LinkedIn grants only to approved partners.
- **@mentions** need the mentioned member's URN, which self-serve apps cannot look up, so they post as plain text.
- **Token refresh**: self-serve member tokens last **60 days** and cannot be refreshed. When they expire, tools say so. Disconnect and reconnect the connector to sign in again.

## Architecture

```text
MCP client ──OAuth 2.1 + PKCE──▶ Worker (workers-oauth-provider, grants in KV)
                                   │  /authorize: consent page (bound to the browser by cookie)
                                   │  └─▶ LinkedIn OAuth (openid profile email w_member_social)
                                   │  /callback: exchange code, check member == ALLOWED_LINKEDIN_SUB
                                   ▼
                                 /mcp tools ──▶ api.linkedin.com (/v2/userinfo, /rest/posts, /rest/images)
```

The LinkedIn access token is stored only inside the encrypted grant props of `@cloudflare/workers-oauth-provider` in KV `OAUTH_KV`. Only the LinkedIn member whose OpenID `sub` equals the `ALLOWED_LINKEDIN_SUB` secret can complete a grant. Anyone else, including other LinkedIn users, is refused.

## Setup

### 1. LinkedIn developer app (owner, one-time)

1. <https://www.linkedin.com/developers/apps/new>. LinkedIn requires the app to be associated with a LinkedIn **Page**. Any Page you admin works, and the app still posts as *you*.
2. **Products** tab: add **Share on LinkedIn** and **Sign In with LinkedIn using OpenID Connect** (both self-serve, approved instantly).
3. **Auth** tab: add the redirect URL `https://linkedin-connector.playwhiteshark.workers.dev/callback` (and `http://localhost:8787/callback` for local dev).
4. Keep the Client ID and Primary Client Secret for step 3. Never paste them into chat, Git or issues.

### 2. Cloudflare resources

```powershell
npm install
npx wrangler login
npx wrangler kv namespace create OAUTH_KV   # put the returned id into wrangler.jsonc
```

### 3. Secrets and deploy

```powershell
npx wrangler secret put LINKEDIN_CLIENT_ID
npx wrangler secret put LINKEDIN_CLIENT_SECRET
npx wrangler secret put ALLOWED_LINKEDIN_SUB   # see step 4 if you don't know it yet
npm run deploy
```

### 4. Find your member id (`ALLOWED_LINKEDIN_SUB`)

Set `ALLOWED_LINKEDIN_SUB` to any placeholder, deploy, and connect once (step 5). The refusal page shows your LinkedIn member id. Set the secret to that value (`npx wrangler secret put ALLOWED_LINKEDIN_SUB`) and connect again. Secret changes apply without a redeploy.

### 5. Connect an assistant

- **Claude** (claude.ai / desktop): Settings → Connectors → Add custom connector → URL `https://linkedin-connector.playwhiteshark.workers.dev/mcp`.
- **ChatGPT**: Settings → Apps & Connectors → developer mode → create connector with the same URL (OAuth).
- **Claude Code**: `claude mcp add --transport http linkedin https://linkedin-connector.playwhiteshark.workers.dev/mcp`

Sign in with LinkedIn when prompted, then ask the assistant to run `linkedin_whoami`.

## Development

```powershell
copy .dev.vars.example .dev.vars   # fill in values; never commit
npm run dev        # http://localhost:8787
npm run typecheck
npm test
npm run build      # bundle dry-run
```

`LINKEDIN_API_VERSION` (`wrangler.jsonc` vars) is LinkedIn's `YYYYMM` REST version. LinkedIn supports each version for about a year. If posting starts failing with a version error, bump it and redeploy.

## Deployment path

Manual `npm run deploy` from the owner's laptop. Record changes to Worker name, bindings or secret names in `personal-ops/configurations/cloudflare-account/README.md`.
