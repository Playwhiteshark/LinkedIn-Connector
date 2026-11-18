import { test } from "node:test";
import assert from "node:assert/strict";

import { decideOwner } from "../src/owner.ts";

const me = { sub: "abc123", email: "Owner@Example.com", emailVerified: true };

test("explicit sub allows only that member", () => {
  assert.deepEqual(decideOwner(me, { allowedSub: "abc123" }), { allow: true, pin: false });
  assert.deepEqual(decideOwner({ ...me, sub: "other" }, { allowedSub: "abc123", allowedEmail: "owner@example.com" }), { allow: false, reason: "not-owner" });
});

test("verified matching email allows and pins on first sign-in", () => {
  assert.deepEqual(decideOwner(me, { allowedEmail: "owner@example.com" }), { allow: true, pin: true });
});

test("pinned sub wins over email afterwards", () => {
  assert.deepEqual(decideOwner(me, { pinnedSub: "abc123", allowedEmail: "x@y.z" }), { allow: true, pin: false });
  assert.deepEqual(decideOwner({ ...me, sub: "intruder" }, { pinnedSub: "abc123", allowedEmail: "owner@example.com" }), { allow: false, reason: "not-owner" });
});

test("unverified or different email is refused", () => {
  assert.deepEqual(decideOwner({ ...me, emailVerified: false }, { allowedEmail: "owner@example.com" }), { allow: false, reason: "email-unverified" });
  assert.deepEqual(decideOwner({ ...me, email: "someone@else.com" }, { allowedEmail: "owner@example.com" }), { allow: false, reason: "not-owner" });
  assert.deepEqual(decideOwner({ sub: "abc123" }, { allowedEmail: "owner@example.com" }), { allow: false, reason: "not-owner" });
});

test("nothing configured fails closed", () => {
  assert.deepEqual(decideOwner(me, {}), { allow: false, reason: "not-configured" });
  assert.deepEqual(decideOwner(me, { allowedSub: "  " }), { allow: false, reason: "not-configured" });
});
