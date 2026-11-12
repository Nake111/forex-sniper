import test from "node:test";
import assert from "node:assert/strict";
import { parseRiskReward, formatRiskReward, parseCandidateStrength } from "../src/signal-format.js";
test("parses colon and scalar risk/reward without Number('1:2') failure", () => {
  assert.equal(parseRiskReward("1:2.0"), 2);
  assert.equal(parseRiskReward("1 / 2.25"), 2.25);
  assert.equal(parseRiskReward("2.5"), 2.5);
  assert.equal(parseRiskReward("not available"), null);
  assert.equal(formatRiskReward("1:2"), "1:2.00");
});
test("labels 100/100 as candidate strength and evidence coverage, never probability", () => {
  const score = parseCandidateStrength("100/100 / 100%");
  assert.equal(score.score, 100);
  assert.equal(score.maxScore, 100);
  assert.equal(score.evidenceCoveragePct, 100);
  assert.equal(score.label, "Candidate strength");
  assert.match(score.interpretation, /not trade probability/i);
  assert.equal(parseCandidateStrength("101/100 / 100%"), null);
});
