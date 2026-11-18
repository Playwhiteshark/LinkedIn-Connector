import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type { GrantProps } from "./auth-handler.ts";
import { LinkedInClient, LinkedInError, postUrl } from "./linkedin-api.ts";
import { MAX_COMMENTARY_CHARS, toCommentary } from "./little-text.ts";

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif"] as const;
const DAY_MS = 24 * 3600 * 1000;

type Result = { content: { type: "text"; text: string }[]; isError?: boolean };

const ok = (text: string): Result => ({ content: [{ type: "text", text }] });
const fail = (text: string): Result => ({ isError: true, content: [{ type: "text", text }] });

const RECONNECT =
  "LinkedIn access for this connector has expired or was revoked. Ask the user to disconnect and reconnect the LinkedIn Connector in their assistant's connector settings (LinkedIn tokens last 60 days).";

export function registerTools(server: McpServer, env: Env, getProps: () => GrantProps | null): void {
  const client = (): LinkedInClient | Result => {
    const props = getProps();
    if (!props) return fail("Not authenticated.");
    if (Date.now() >= props.expiresAt) return fail(RECONNECT);
    return new LinkedInClient(props.accessToken, props.sub, env.LINKEDIN_API_VERSION);
  };

  const run = async (fn: (li: LinkedInClient) => Promise<Result>): Promise<Result> => {
    const li = client();
    if (!(li instanceof LinkedInClient)) return li;
    try {
      return await fn(li);
    } catch (error) {
      if (error instanceof LinkedInError) {
        if (error.status === 401) return fail(RECONNECT);
        return fail(error.message);
      }
      return fail(error instanceof Error ? error.message : String(error));
    }
  };

  server.registerTool(
    "linkedin_whoami",
    {
      title: "LinkedIn account",
      description: "Show which LinkedIn member this connector posts as and when its LinkedIn access expires.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => {
      const props = getProps();
      if (!props) return fail("Not authenticated.");
      const daysLeft = Math.floor((props.expiresAt - Date.now()) / DAY_MS);
      return ok(JSON.stringify({
        name: props.name,
        memberUrn: `urn:li:person:${props.sub}`,
        linkedinAccessExpires: new Date(props.expiresAt).toISOString(),
        daysLeft,
        scopes: props.scope,
        capabilities: ["create text/link/image posts as the member", "delete the member's posts"],
        notAvailable: "Editing profile fields (headline, about, experience) and reading the feed, comments or analytics are not available through LinkedIn's self-serve API.",
      }, null, 2));
    },
  );

  server.registerTool(
    "linkedin_create_post",
    {
      title: "Publish a LinkedIn post",
      description: [
        "Publish a post to the user's own LinkedIn feed, as the user. This is immediate and visible to others.",
        "Only call this after showing the user the exact final text (and any link or image) and getting their explicit approval to post it; set confirm_publish to true only then.",
        "Write plain text: #hashtags become real hashtags and all other characters are escaped automatically. @mentions are not supported and appear as plain text.",
        "Attach at most one of link or image.",
      ].join(" "),
      inputSchema: z.object({
        text: z.string().min(1).max(MAX_COMMENTARY_CHARS).describe("Post body, plain text with optional #hashtags."),
        visibility: z.enum(["PUBLIC", "CONNECTIONS"]).default("PUBLIC"),
        link: z.object({
          url: z.url(),
          title: z.string().max(400).optional(),
          description: z.string().max(4086).optional(),
        }).optional().describe("Optional article/link card."),
        image: z.object({
          url: z.url().optional().describe("Public https URL of a JPEG, PNG or GIF."),
          base64: z.string().optional().describe("Base64 image bytes, used instead of url."),
          mime_type: z.enum(IMAGE_TYPES).optional().describe("Required with base64."),
          alt_text: z.string().max(4086).optional(),
        }).optional().describe("Optional single image."),
        confirm_publish: z.literal(true).describe("Must be true, meaning the user explicitly approved publishing this exact post."),
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async (input) =>
      run(async (li) => {
        if (input.link && input.image) return fail("Attach either a link or an image, not both.");
        const commentary = toCommentary(input.text);
        if (commentary.length > MAX_COMMENTARY_CHARS) {
          return fail(`Post is too long after formatting (${commentary.length}/${MAX_COMMENTARY_CHARS} characters).`);
        }
        let image: { urn: string; altText?: string } | undefined;
        if (input.image) {
          const loaded = await loadImage(input.image);
          if ("error" in loaded) return fail(loaded.error);
          image = { urn: await li.uploadImage(loaded.bytes, loaded.type), ...(input.image.alt_text ? { altText: input.image.alt_text } : {}) };
        }
        const urn = await li.createPost({
          commentary,
          visibility: input.visibility,
          ...(input.link ? { article: { source: input.link.url, ...(input.link.title ? { title: input.link.title } : {}), ...(input.link.description ? { description: input.link.description } : {}) } } : {}),
          ...(image ? { image } : {}),
        });
        return ok(JSON.stringify({ published: true, postUrn: urn, url: postUrl(urn), visibility: input.visibility }, null, 2));
      }),
  );

  server.registerTool(
    "linkedin_delete_post",
    {
      title: "Delete a LinkedIn post",
      description: "Permanently delete one of the user's own LinkedIn posts by its URN (urn:li:share:… or urn:li:ugcPost:…, as returned by linkedin_create_post or shown in the post's URL). Cannot be undone; only call after the user explicitly confirms, then set confirm_delete to true.",
      inputSchema: z.object({
        post_urn: z.string().regex(/^urn:li:(share|ugcPost):\d+$/, "Expected urn:li:share:<id> or urn:li:ugcPost:<id>"),
        confirm_delete: z.literal(true),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async (input) =>
      run(async (li) => {
        await li.deletePost(input.post_urn);
        return ok(JSON.stringify({ deleted: true, postUrn: input.post_urn }));
      }),
  );
}

async function loadImage(image: { url?: string | undefined; base64?: string | undefined; mime_type?: string | undefined }): Promise<{ bytes: ArrayBuffer; type: string } | { error: string }> {
  if (image.base64) {
    if (!image.mime_type) return { error: "mime_type is required with base64 image data." };
    let bin: string;
    try {
      bin = atob(image.base64.replace(/^data:[^,]*,/, "").replace(/\s+/g, ""));
    } catch {
      return { error: "image.base64 is not valid base64." };
    }
    if (bin.length > MAX_IMAGE_BYTES) return { error: "Image is larger than 8 MB." };
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes: bytes.buffer, type: image.mime_type };
  }
  if (!image.url) return { error: "Provide image.url or image.base64." };
  if (!image.url.startsWith("https://")) return { error: "image.url must be https." };
  const res = await fetch(image.url, { redirect: "follow" });
  if (!res.ok) return { error: `Could not download image (${res.status}).` };
  const type = (res.headers.get("Content-Type") ?? "").split(";")[0]!.trim().toLowerCase();
  if (!(IMAGE_TYPES as readonly string[]).includes(type)) return { error: `Unsupported image type "${type || "unknown"}"; use JPEG, PNG or GIF.` };
  const declared = Number(res.headers.get("Content-Length") ?? "0");
  if (declared > MAX_IMAGE_BYTES) return { error: "Image is larger than 8 MB." };
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_IMAGE_BYTES) return { error: "Image is larger than 8 MB." };
  return { bytes, type };
}
