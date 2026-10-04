import assert from "node:assert/strict";
import test from "node:test";
import { slugify } from "./slugify.js";

test("the slug is lower case", () => {
  assert.equal(slugify("Hello"), "hello");
});

test("spaces become single dashes", () => {
  assert.equal(slugify("hello   big world"), "hello-big-world");
});

test("characters outside a-z and 0-9 are dropped", () => {
  assert.equal(slugify("héllo, wörld 42!"), "hllo-wrld-42");
});
