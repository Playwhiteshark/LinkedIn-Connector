import { test } from "node:test";
import assert from "node:assert/strict";

import { escapeLittleText, toCommentary } from "../src/little-text.ts";

test("escapes every reserved character", () => {
  assert.equal(escapeLittleText("a|b{c}d@e[f]g(h)i<j>k#l\\m*n_o~p"),
    "a\\|b\\{c\\}d\\@e\\[f\\]g\\(h\\)i\\<j\\>k\\#l\\\\m\\*n\\_o\\~p");
});

test("plain text is unchanged", () => {
  assert.equal(toCommentary("Hello, world. 100% done!"), "Hello, world. 100% done!");
});

test("hashtags become hashtag templates", () => {
  assert.equal(toCommentary("Shipped it #robotics #UCL_2026"),
    "Shipped it {hashtag|\\#|robotics} {hashtag|\\#|UCL\\_2026}");
});

test("hashtag at start and after newline", () => {
  assert.equal(toCommentary("#one\n#two"), "{hashtag|\\#|one}\n{hashtag|\\#|two}");
});

test("mid-word and lone # are escaped, not hashtags", () => {
  assert.equal(toCommentary("C# and issue# 5 and #"), "C\\# and issue\\# 5 and \\#");
});

test("brackets in text are escaped", () => {
  assert.equal(toCommentary("(see [docs])"), "\\(see \\[docs\\]\\)");
});
