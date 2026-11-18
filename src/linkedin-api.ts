// Thin client for the LinkedIn endpoints available to a self-serve app with the
// "Sign In with LinkedIn using OpenID Connect" and "Share on LinkedIn" products.

export const LINKEDIN_SCOPES = ["openid", "profile", "email", "w_member_social"] as const;

export type LinkedInUserInfo = {
  sub: string;
  name?: string;
  given_name?: string;
  family_name?: string;
  email?: string;
  email_verified?: boolean;
  picture?: string;
  locale?: unknown;
};

export class LinkedInError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export function authorizationUrl(clientId: string, redirectUri: string, state: string): string {
  const url = new URL("https://www.linkedin.com/oauth/v2/authorization");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", LINKEDIN_SCOPES.join(" "));
  return url.toString();
}

export async function exchangeCode(
  env: Env,
  code: string,
  redirectUri: string,
): Promise<{ accessToken: string; expiresAt: number; scope: string }> {
  const res = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: env.LINKEDIN_CLIENT_ID,
      client_secret: env.LINKEDIN_CLIENT_SECRET,
    }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof body.access_token !== "string") {
    throw new LinkedInError(`LinkedIn token exchange failed (${res.status}): ${describe(body)}`, res.status);
  }
  const expiresIn = typeof body.expires_in === "number" ? body.expires_in : 60 * 24 * 3600;
  return {
    accessToken: body.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
    scope: typeof body.scope === "string" ? body.scope : "",
  };
}

export async function getUserInfo(accessToken: string): Promise<LinkedInUserInfo> {
  const res = await fetch("https://api.linkedin.com/v2/userinfo", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || typeof body.sub !== "string") {
    throw new LinkedInError(`LinkedIn userinfo failed (${res.status}): ${describe(body)}`, res.status);
  }
  return body as LinkedInUserInfo;
}

export class LinkedInClient {
  constructor(
    private readonly accessToken: string,
    private readonly memberSub: string,
    private readonly apiVersion: string,
  ) {}

  get personUrn(): string {
    return `urn:li:person:${this.memberSub}`;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: `Bearer ${this.accessToken}`,
      "LinkedIn-Version": this.apiVersion,
      "X-Restli-Protocol-Version": "2.0.0",
      ...extra,
    };
  }

  /** Upload an image and return its `urn:li:image:...`. */
  async uploadImage(bytes: ArrayBuffer, contentType: string): Promise<string> {
    const init = await fetch("https://api.linkedin.com/rest/images?action=initializeUpload", {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ initializeUploadRequest: { owner: this.personUrn } }),
    });
    const initBody = (await init.json().catch(() => ({}))) as { value?: { uploadUrl?: string; image?: string } };
    const uploadUrl = initBody.value?.uploadUrl;
    const imageUrn = initBody.value?.image;
    if (!init.ok || !uploadUrl || !imageUrn) {
      throw new LinkedInError(`LinkedIn image upload init failed (${init.status}): ${describe(initBody)}`, init.status);
    }
    const put = await fetch(uploadUrl, {
      method: "PUT",
      headers: { Authorization: `Bearer ${this.accessToken}`, "Content-Type": contentType },
      body: bytes,
    });
    if (!put.ok) {
      throw new LinkedInError(`LinkedIn image upload failed (${put.status}): ${await put.text().catch(() => "")}`, put.status);
    }
    return imageUrn;
  }

  async createPost(post: {
    commentary: string;
    visibility: "PUBLIC" | "CONNECTIONS";
    article?: { source: string; title?: string; description?: string };
    image?: { urn: string; altText?: string };
  }): Promise<string> {
    const body: Record<string, unknown> = {
      author: this.personUrn,
      commentary: post.commentary,
      visibility: post.visibility,
      distribution: { feedDistribution: "MAIN_FEED", targetEntities: [], thirdPartyDistributionChannels: [] },
      lifecycleState: "PUBLISHED",
      isReshareDisabledByAuthor: false,
    };
    if (post.image) {
      body.content = { media: { id: post.image.urn, ...(post.image.altText ? { altText: post.image.altText } : {}) } };
    } else if (post.article) {
      const article: Record<string, string> = { source: post.article.source };
      if (post.article.title) article.title = post.article.title;
      if (post.article.description) article.description = post.article.description;
      body.content = { article };
    }
    const res = await fetch("https://api.linkedin.com/rest/posts", {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    if (res.status !== 201 && !res.ok) {
      const err = await res.json().catch(async () => await res.text().catch(() => ""));
      throw new LinkedInError(`LinkedIn post creation failed (${res.status}): ${describe(err)}`, res.status);
    }
    const urn = res.headers.get("x-restli-id") ?? res.headers.get("x-linkedin-id");
    if (!urn) throw new LinkedInError("LinkedIn accepted the post but returned no post id.", res.status);
    return urn;
  }

  async deletePost(urn: string): Promise<void> {
    const res = await fetch(`https://api.linkedin.com/rest/posts/${encodeURIComponent(urn)}`, {
      method: "DELETE",
      headers: this.headers({ "X-RestLi-Method": "DELETE" }),
    });
    if (res.status !== 204 && !res.ok) {
      const err = await res.json().catch(async () => await res.text().catch(() => ""));
      throw new LinkedInError(`LinkedIn post deletion failed (${res.status}): ${describe(err)}`, res.status);
    }
  }
}

export function postUrl(urn: string): string {
  return `https://www.linkedin.com/feed/update/${urn}/`;
}

function describe(body: unknown): string {
  if (typeof body === "string") return body.slice(0, 500);
  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    const msg = o.message ?? o.error_description ?? o.error;
    if (typeof msg === "string") return msg;
    return JSON.stringify(body).slice(0, 500);
  }
  return "no details";
}
