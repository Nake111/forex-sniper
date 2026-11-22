import test from "node:test";
import assert from "node:assert/strict";
import { parseStatusEvidence } from "./report-status-evidence.js";

test("parses approved status and JSON blockers from pipe-delimited evidence", () => {
  const parsed = parseStatusEvidence(
    'PASSED | approved: true | blockers: []',
    { statusKey: "status", booleanKey: "paperApproved", blockersKey: "paperBlockers" }
  );
  assert.deepEqual(parsed, {
    status: "PASSED",
    paperApproved: true,
    paperBlockers: []
  });
});

test("parses a rejected status and preserves blocker messages", () => {
  const blockers = ["quote is stale", "entry trigger missing"];
  const parsed = parseStatusEvidence(
    'BLOCKED | approved: false | blockers: ["quote is stale","entry trigger missing"]',
    { statusKey: "decision", booleanKey: "approved", blockersKey: "blockers" }
  );
  assert.deepEqual(parsed, {
    decision: "BLOCKED",
    approved: false,
    blockers
  });
});

test("does not coerce malformed booleans or non-array blockers", () => {
  const parsed = parseStatusEvidence(
    'UNKNOWN | approved: maybe | blockers: {"unexpected":true}',
    { statusKey: "status", booleanKey: "approved", blockersKey: "blockers" }
  );
  assert.deepEqual(parsed, { status: "UNKNOWN", blockers: [] });
});

test("rejects missing status evidence", () => {
  assert.throws(() => parseStatusEvidence(""), /non-empty string/);
});
