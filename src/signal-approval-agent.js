export function runSignalApprovalAgent({
  candidate, marketReview, plan, quoteValidation, quote,
  dataStale = false, executionBlockers = [], now = Date.now()
}) {
  const blockers = [...executionBlockers];
  if (!["BUY", "SELL"].includes(candidate)) blockers.push("No directional candidate");
  if (!marketReview?.approved) blockers.push(...(marketReview?.blockers ?? ["Market-intelligence agent did not approve"]));
  if (marketReview?.direction && marketReview.direction !== candidate) blockers.push("Independent market-intelligence direction conflicts with candidate");
  if (!plan || !Number.isFinite(plan.entry) || !Number.isFinite(plan.stopLoss) || !Number.isFinite(plan.takeProfit)) {
    blockers.push("Entry/stop/target plan is incomplete");
  } else {
    const correct = candidate === "BUY"
      ? plan.stopLoss < plan.entry && plan.takeProfit > plan.entry
      : plan.stopLoss > plan.entry && plan.takeProfit < plan.entry;
    if (!correct) blockers.push("Stop-loss or take-profit is on the wrong side of entry");
    if (!(Number(plan.riskRewardValue) >= 2)) blockers.push("Risk/reward is below 1:2");
    if (plan.entryTriggerConfirmed !== true) blockers.push("Closed M5 entry trigger is not confirmed");
  }
  if (!quoteValidation?.valid) blockers.push(quoteValidation?.reason ?? "Fresh bid/ask quote is not validated");
  if (!quote || !Number.isFinite(quote.bid) || !Number.isFinite(quote.ask)) blockers.push("Bid/ask quote missing");
  else if (candidate === "BUY" && plan && quote.ask <= 0 || candidate === "SELL" && plan && quote.bid <= 0) blockers.push("Executable-side quote is invalid");
  if (dataStale) blockers.push("One or more required candle timeframes are stale");
  const unique = [...new Set(blockers.filter(Boolean))];
  const approved = unique.length === 0 && marketReview?.approved === true &&
    ["BUY", "SELL"].includes(candidate);
  return {
    agent: "SIGNAL_APPROVAL_AGENT",
    version: "1.0.0",
    market: marketReview?.market ?? plan?.market ?? "UNKNOWN",
    candidate: ["BUY", "SELL"].includes(candidate) ? candidate : "NO TRADE",
    decision: approved ? candidate : "NO APPROVED TRADE",
    approved,
    approvalType: approved ? "PAPER_SIGNAL_APPROVED" : "REJECTED",
    checkedAt: new Date(now).toISOString(),
    bid: quote?.bid ?? null,
    ask: quote?.ask ?? null,
    spread: quoteValidation?.spread ?? null,
    entry: plan?.entry ?? null,
    stopLoss: plan?.stopLoss ?? null,
    takeProfit: plan?.takeProfit ?? null,
    blockers: unique
  };
}
