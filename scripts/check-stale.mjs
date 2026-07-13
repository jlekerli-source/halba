import assert from "node:assert/strict";
import { isStale } from "../src/domain/stale.js";

const now = new Date("2026-06-23T12:00:00Z");

assert.equal(isStale({ lastProofDate: "2026-06-20", proofWindowDays: 7 }, now), false);
assert.equal(isStale({ lastProofDate: "2026-06-16", proofWindowDays: 7 }, now), false);
assert.equal(isStale({ lastProofDate: "2026-06-15", proofWindowDays: 7 }, now), true);
assert.equal(isStale({ lastProofDate: "2026-06-01", proofWindowDays: 7 }, now), true);
assert.equal(isStale({ lastProofDate: "", proofWindowDays: 7 }, now), true);

console.log("check passed: stale rules work");
