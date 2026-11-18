# LinkedIn Connector

A remote MCP server (Cloudflare Worker) that lets your assistants (Claude, ChatGPT and other MCP clients) post to **your own LinkedIn account** through LinkedIn's official API. Claude drafts, you approve the exact text, then it publishes. Each deployment is locked to one LinkedIn member and uses only LinkedIn's self-serve products: no scraping, no unofficial endpoints, no bot account.

## Build your own

Every deployment is personal: you run your own Worker with your own LinkedIn app, so nobody else holds your LinkedIn token. The repo ships a Claude Code skill that walks Claude through the whole setup (Cloudflare, the LinkedIn developer app, secrets, deploy and connecting Claude), including the gotchas found along the way.

```text
/plugin install linkedin-connector --marketplace Playwhiteshark/LinkedIn-Connector
```

Then ask Claude: *"Set up my own LinkedIn connector."* You sign in to each service and type the secrets yourself; Claude runs the rest. Prefer to do it by hand? Follow [Setup](#setup) below, or read the [skill](skills/deploy-linkedin-connector/SKILL.md) as a checklist.

## The author's deployment

For reference; your own values will differ (you must replace the KV id in `wrangler.jsonc`).

| Item | Value |
|---|---|
| Worker | `linkedin-connector` on `playwhiteshark.workers.dev` (MCP endpoint `/mcp`), KV `OAUTH_KV` = `linkedin-connector-oauth-kv` |
| Secret names | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`, `ALLOWED_LINKEDIN_EMAIL` |
| LinkedIn developer app | "Playwhiteshark Post Connector" (app id 266766209), products Share on LinkedIn + Sign In with LinkedIn using OpenID Connect |
| LinkedIn Page (app publisher) | "Playwhiteshark Tools" (`linkedin.com/company/146997329`), owner is the admin |

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
                                   │  /callback: exchange code, check member is the owner (see below)
                                   ▼
                                 /mcp tools ──▶ api.linkedin.com (/v2/userinfo, /rest/posts, /rest/images)
```

The LinkedIn access token is stored only inside the encrypted grant props of `@cloudflare/workers-oauth-provider` in KV `OAUTH_KV`.

**Owner lock.** Only one LinkedIn member can complete a grant:

1. If the `ALLOWED_LINKEDIN_SUB` secret is set, only that OpenID `sub` is accepted.
2. Otherwise, the first sign-in whose **verified** LinkedIn primary email equals the `ALLOWED_LINKEDIN_EMAIL` secret is accepted, and its `sub` is pinned in KV (`owner:sub`). From then on, only that member is accepted, even if someone else later controls that email address.

Anyone else, including other LinkedIn users, is refused. To reset ownership, delete the `owner:sub` KV key.

## Setup

### 1. LinkedIn developer app (owner, one-time)

1. <https://www.linkedin.com/developers/apps/new>. The app name may not contain "LinkedIn". LinkedIn requires the app to be associated with a LinkedIn **Page**. Any Page you admin works, and the app still posts as *you*.
2. **Products** tab: add **Share on LinkedIn** and **Sign In with LinkedIn using OpenID Connect** (both self-serve, approved instantly).
3. **Auth** tab: add the redirect URL `https://linkedin-connector.playwhiteshark.workers.dev/callback` (and `http://localhost:8787/callback` for local dev).
4. Keep the Client ID and Primary Client Secret for step 3. Never paste them into chat, Git or issues.

### 2. Cloudflare resources

```powershell
npm install
npx wrangler login
npx wrangler kv namespace create OAUTH_KV   # put the returned id into wrangler.jsonc
```

Replace the URLs below (`linkedin-connector.playwhiteshark.workers.dev`) with your own Worker's hostname throughout.

### 3. Secrets and deploy

```powershell
npx wrangler secret put LINKEDIN_CLIENT_ID
npx wrangler secret put LINKEDIN_CLIENT_SECRET
npx wrangler secret put ALLOWED_LINKEDIN_EMAIL   # your LinkedIn primary email (must be verified on LinkedIn)
npm run deploy
```

Optionally set `ALLOWED_LINKEDIN_SUB` instead of the email lock. The refusal page shows your member id if neither is set.

### 4. Connect an assistant

- **Claude** (claude.ai / desktop / mobile): Customize → Connectors → Add → Add custom connector → URL `https://linkedin-connector.playwhiteshark.workers.dev/mcp`. Either OAuth client option works (Claude's published identity/CIMD, or automatic registration/DCR).
- **ChatGPT**: Settings → Apps & Connectors → developer mode → create connector with the same URL (OAuth).
- **Claude Code**: `claude mcp add --transport http linkedin https://linkedin-connector.playwhiteshark.workers.dev/mcp`

Sign in with LinkedIn when prompted, then ask the assistant to run `linkedin_whoami`.

**Sign-in tip:** LinkedIn's OAuth sign-in page may show only email and password, with no Sign in with Apple or Google button. If you normally use Apple, either start the connection from a device where LinkedIn's page offers Apple, or set a LinkedIn password once with "Forgot password?". Apple sign-in keeps working afterwards.

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

Manual `npm run deploy`. CI (GitHub Actions) runs audit, typecheck, tests and a bundle dry-run on every push; it never deploys.

## Licence

[MIT](LICENSE).
