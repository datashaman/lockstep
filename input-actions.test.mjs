import assert from "node:assert/strict";
import { actionForKey, releaseForKey } from "./lib/input-actions.js";
for (const [key, lane] of [
  ["j", 0],
  ["K", 1],
  ["l", 2],
])
  assert.deepEqual(actionForKey("play", key), { type: "hit", lane });
for (const key of ["a", "ArrowLeft"])
  assert.deepEqual(actionForKey("play", key), { type: "move", delta: -1 });
assert.deepEqual(actionForKey("title", "ArrowLeft"), {
  type: "difficulty",
  delta: -1,
});
assert.deepEqual(actionForKey("pause", "Enter"), { type: "resume" });
assert.deepEqual(actionForKey("failed", "Enter"), { type: "restart" });
assert.deepEqual(actionForKey("title", "T", true), {
  type: "theme",
  useAsDefault: true,
});
assert.deepEqual(actionForKey("over", "t"), { type: "autoCalibrate" });
assert.deepEqual(actionForKey("over", "c"), { type: "share" });
for (const screen of ["failed", "play", "pause"])
  assert.equal(actionForKey(screen, "c"), null, "share a score only from the results screen");
for (const screen of ["failed", "play", "pause"])
  assert.equal(actionForKey(screen, "t"), null);
assert.deepEqual(actionForKey("pause", "]"), { type: "calibrate", delta: 1 });
assert.deepEqual(actionForKey("play", " "), { type: "pause" });
for (const [key, lane] of [["j", 0], ["K", 1], ["l", 2]])
  assert.deepEqual(releaseForKey("play", key), { type: "release", lane });
for (const screen of ["title", "pause", "over", "failed", "find"])
  assert.equal(releaseForKey(screen, "j"), null);
for (const key of ["a", "Enter", " ", "jk", ""])
  assert.equal(releaseForKey("play", key), null);
for (const screen of ["loading", "find"])
  for (const key of ["j", "Enter", "ArrowLeft"])
    assert.equal(actionForKey(screen, key), null);
for (const key of ["", "jk", "unknown"])
  assert.equal(actionForKey("play", key), null);
assert.deepEqual(actionForKey("title", "p"), { type: "practice" });
for (const screen of ["play", "pause", "over", "failed"])
  assert.equal(actionForKey(screen, "p"), null, "practice starts from the title only");
assert.deepEqual(actionForKey("play", "-"), { type: "speed", delta: -1 });
assert.deepEqual(actionForKey("play", "="), { type: "speed", delta: 1 });
assert.deepEqual(actionForKey("play", "b"), { type: "loop" });
assert.deepEqual(actionForKey("play", "B"), { type: "loop" });
for (const screen of ["title", "pause", "over", "failed"])
  for (const key of ["-", "=", "b"]) assert.equal(actionForKey(screen, key), null);
console.log(
  "ok: context-sensitive keyboard/touch actions, modifiers, calibration and inactive screens",
);
