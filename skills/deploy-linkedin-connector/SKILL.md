---
name: deploy-linkedin-connector
description: Deploy your own private LinkedIn MCP connector (Cloudflare Worker, official LinkedIn API) so Claude can publish and delete posts on the user's own LinkedIn account with explicit approval. Use when the user wants Claude to post to LinkedIn for them, asks to set up or redeploy this connector, or hits a problem connecting it.
---

# Deploy a private LinkedIn connector for Claude

You are setting up a remote MCP server that lets the user's assistants post to **their own** LinkedIn account through LinkedIn's official, self-serve API. The source is this repository (`Playwhiteshark/LinkedIn-Connector`). The result: a Cloudflare Worker at `https://<worker>.<subdomain>.workers.dev/mcp`, added as a Claude custom connector, locked to one LinkedIn member.

Work through the phases in order. Each phase ends with a check; don't move on until it passes.

## Ground rules

- **The user handles every credential.** Never ask them to paste the LinkedIn Client Secret, passwords or tokens into chat, and never type them yourself. Secrets go in through `wrangler secret put` prompts that the user types into, or the Cloudflare dashboard.
- **The user signs in** to LinkedIn, Cloudflare and Claude themselves.
- Creating the LinkedIn app, a LinkedIn Page and accepting LinkedIn's API terms are actions on the user's account: ask before each one.
- Official API only. No scraping, unofficial endpoints or browser automation of linkedin.com feeds.
- After setup, **publishing is outward-facing**: show the exact final post and get explicit approval before every `linkedin_create_post` or `linkedin_delete_post`.

## Phase 0: Prerequisites

Need: Node 22+ (`node --version`), git, a Cloudflare account (free plan is enough), a LinkedIn account, and a Claude plan that supports custom connectors.

```sh
git clone https://github.com/Playwhiteshark/LinkedIn-Connector.git
cd LinkedIn-Connector
npm install
npm test && npm run typecheck
```

If npm blocks install scripts for `esbuild` or `workerd`, approve them (`npm approve-scripts` on npm 11+) and run `npm rebuild`.

**Check:** tests pass.

## Phase 1: Cloudflare

```sh
npx wrangler login          # user approves in the browser
npx wrangler whoami         # confirm the right account
npx wrangler kv namespace create OAUTH_KV
```

Edit `wrangler.jsonc`:
- set `kv_namespaces[0].id` to the id just returned (the committed id belongs to the original author and will not work for anyone else);
- optionally change `"name"` (this becomes the Worker hostname).

Work out the final URL: `https://<name>.<account-subdomain>.workers.dev`. Find the subdomain in the Cloudflare dashboard under Workers & Pages, or from the first deploy's output.

**Check:** `npx wrangler kv namespace list` shows the namespace.

## Phase 2: LinkedIn developer app (user's account)

LinkedIn requires every app to belong to a **LinkedIn Page** the user administers. If they don't have one, they can create a small Page for their projects at <https://www.linkedin.com/company/setup/new/>. The app still posts as the *member*, not the Page.

1. <https://www.linkedin.com/developers/apps/new>
   - **App name must not contain "LinkedIn"** (it is rejected). Something like "<Name> Post Connector" works.
   - Associate the Page, upload a logo, accept the API terms (ask the user first).
2. **Products** tab: request **Share on LinkedIn** and **Sign In with LinkedIn using OpenID Connect**. Both are self-serve and approved instantly.
3. **Auth** tab: add the redirect URL `https://<worker-url>/callback` (and `http://localhost:8787/callback` for local dev). It must match exactly.
4. Confirm the Auth tab lists scopes `openid`, `profile`, `email`, `w_member_social`.

**Check:** both products show as added, the redirect URL is saved.

## Phase 3: Secrets and deploy

The user types each value into the prompt; you only run the commands.

```sh
npx wrangler secret put LINKEDIN_CLIENT_ID        # from the Auth tab
npx wrangler secret put LINKEDIN_CLIENT_SECRET    # Primary Client Secret, user types it
npx wrangler secret put ALLOWED_LINKEDIN_EMAIL    # user's verified LinkedIn primary email
npm run deploy
```

**Owner lock:** the first sign-in whose verified primary email equals `ALLOWED_LINKEDIN_EMAIL` pins that member's id in KV (`owner:sub`); afterwards only that member can connect. Alternatively set `ALLOWED_LINKEDIN_SUB` directly. With neither set, every sign-in is refused and the refusal page shows the member id to use.

Smoke test:

```sh
curl https://<worker-url>/healthz
curl https://<worker-url>/.well-known/oauth-authorization-server
```

A Cloudflare **error 1042** in the first minute after a first deploy is propagation; wait and retry.

**Check:** `/healthz` returns ok and the metadata lists `/authorize`, `/token` and `/register`.

## Phase 4: Connect Claude

The user does this in Claude (web, desktop or mobile): **Customize → Connectors → Add custom connector**, URL `https://<worker-url>/mcp`. Either OAuth client option works.

If Claude says it couldn't reach or check the server, first compare the saved URL character by character: a dropped letter (`workers.de`) is the usual cause.

Then **Connect** → consent page → **Continue with LinkedIn** → sign in → **Allow**.

- LinkedIn's OAuth sign-in page often shows only email and password. Users who normally use *Sign in with Apple/Google* can set a LinkedIn password once via "Forgot password?", or start from a device where LinkedIn offers their usual method.

Finally, ask Claude to run `linkedin_whoami`.

**Check:** it returns the user's name, the four scopes and about 60 days until expiry. `npx wrangler kv key get owner:sub --binding OAUTH_KV --remote` returns a value. Don't publish a test post unless the user asks: LinkedIn has no private visibility, so every post reaches their network.

Other clients: Claude Code `claude mcp add --transport http linkedin https://<worker-url>/mcp`; ChatGPT developer-mode connectors take the same URL.

## Operating notes

- **Tokens:** self-serve LinkedIn tokens last 60 days with no refresh. When tools report expiry, disconnect and reconnect the connector.
- **What the API can't do** for self-serve apps: edit profile fields, read the feed, past posts, comments or analytics, or resolve @mentions. Don't promise these.
- **API version:** `LINKEDIN_API_VERSION` in `wrangler.jsonc` is LinkedIn's `YYYYMM` version, supported for about a year. If posting fails with a version error, bump it and redeploy.
- **Reset ownership:** delete the `owner:sub` KV key.
- **Windows:** if `wrangler secret delete` crashes, pipe the confirmation: `echo y | npx wrangler secret delete NAME`.
