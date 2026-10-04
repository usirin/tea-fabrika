// The builder never sees this file. It holds rules the ticket does not spell
// out, so a first attempt is likely to miss one and get sent back.
import assert from "node:assert/strict";
import test from "node:test";
import { parseDuration } from "./duration.js";

test("single units", () => {
  assert.equal(parseDuration("45s"), 45);
  assert.equal(parseDuration("2m"), 120);
  assert.equal(parseDuration("1h"), 3600);
});

test("combined units", () => {
  assert.equal(parseDuration("1h30m"), 5400);
  assert.equal(parseDuration("1h30m15s"), 5415);
});

test("spaces between the parts are fine", () => {
  assert.equal(parseDuration("1h 30m"), 5400);
});

test("units can be upper case", () => {
  assert.equal(parseDuration("1H30M"), 5400);
});

test("a part can be a decimal", () => {
  assert.equal(parseDuration("1.5h"), 5400);
});

test("a bare number is seconds", () => {
  assert.equal(parseDuration("90"), 90);
});

test("units must go from largest to smallest, each at most once", () => {
  assert.equal(parseDuration("30m1h"), null);
  assert.equal(parseDuration("1h1h"), null);
});

test("text that is not a duration is null", () => {
  assert.equal(parseDuration(""), null);
  assert.equal(parseDuration("abc"), null);
  assert.equal(parseDuration("1x"), null);
});
