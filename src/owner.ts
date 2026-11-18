// Decides whether a LinkedIn member may complete a grant on this single-owner connector.

export type OwnerConfig = {
  /** Explicit LinkedIn OpenID `sub` (strongest; overrides everything else). */
  allowedSub?: string | undefined;
  /** Member `sub` pinned in KV after the first successful email-matched sign-in. */
  pinnedSub?: string | null | undefined;
  /** Owner's LinkedIn primary email; used only until a `sub` is pinned. */
  allowedEmail?: string | undefined;
};

export type Member = { sub: string; email?: string | undefined; emailVerified?: boolean | undefined };

export type OwnerDecision =
  | { allow: true; pin: boolean }
  | { allow: false; reason: "not-owner" | "not-configured" | "email-unverified" };

export function decideOwner(member: Member, config: OwnerConfig): OwnerDecision {
  const allowedSub = config.allowedSub?.trim();
  if (allowedSub) return member.sub === allowedSub ? { allow: true, pin: false } : { allow: false, reason: "not-owner" };

  if (config.pinnedSub) {
    return member.sub === config.pinnedSub ? { allow: true, pin: false } : { allow: false, reason: "not-owner" };
  }

  const allowedEmail = config.allowedEmail?.trim().toLowerCase();
  if (!allowedEmail) return { allow: false, reason: "not-configured" };
  if (!member.email || member.email.trim().toLowerCase() !== allowedEmail) return { allow: false, reason: "not-owner" };
  if (member.emailVerified !== true) return { allow: false, reason: "email-unverified" };
  return { allow: true, pin: true };
}

export const OWNER_PIN_KEY = "owner:sub";
