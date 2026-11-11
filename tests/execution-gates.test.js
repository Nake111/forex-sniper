import test from "node:test";
import assert from "node:assert/strict";
import { finalAction } from "../src/trade-plan.js";

const plan = { entryTriggerConfirmed: true };

test("does not issue BUY when broker spread is missing", () => {
  assert.equal(finalAction("BUY", plan, {
    confirmationStatus: "H1 ALIGNED", riskClear: true, spreadVerified: false
  }), "NO TRADE");
});

test("does not issue SELL when M5 trigger is not confirmed", () => {
  assert.equal(finalAction("SELL", { entryTriggerConfirmed: false }, {
    confirmationStatus: "H1 ALIGNED", riskClear: true, spreadVerified: true
  }), "NO TRADE");
});

test("does not issue a signal when H1 confirmation or risk clearance fails", () => {
  assert.equal(finalAction("BUY", plan, {
    confirmationStatus: "WAIT", riskClear: true, spreadVerified: true
  }), "NO TRADE");
  assert.equal(finalAction("SELL", plan, {
    confirmationStatus: "H1 ALIGNED", riskClear: false, spreadVerified: true
  }), "NO TRADE");
});

test("issues BUY or SELL only when every mandatory execution check passes", () => {
  const checks = { confirmationStatus: "H1 ALIGNED", riskClear: true, spreadVerified: true, executionVenueVerified: true };
  assert.equal(finalAction("BUY", plan, checks), "BUY");
  assert.equal(finalAction("SELL", plan, checks), "SELL");
});

test("never promotes HOLD or a missing plan into an order", () => {
  const checks = { confirmationStatus: "H1 ALIGNED", riskClear: true, spreadVerified: true, executionVenueVerified: true };
  assert.equal(finalAction("HOLD", plan, checks), "NO TRADE");
  assert.equal(finalAction("BUY", null, checks), "NO TRADE");
});


test("does not authorize a third-party reference quote without venue verification", () => {
  assert.equal(finalAction("BUY", plan, {
    confirmationStatus: "H1 ALIGNED", riskClear: true, spreadVerified: true,
    executionVenueVerified: false
  }), "NO TRADE");
});
