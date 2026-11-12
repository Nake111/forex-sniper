export function parseRiskReward(value) {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  const ratio = text.match(/^1\\s*[:/]\\s*(\\d+(?:\\.\\d+)?)$/);
  if (ratio) {
    const reward = Number(ratio[1]);
    return Number.isFinite(reward) && reward > 0 ? reward : null;
  }
  const scalar = text.match(/^(\\d+(?:\\.\\d+)?)$/);
  if (!scalar) return null;
  const result = Number(scalar[1]);
  return Number.isFinite(result) && result > 0 ? result : null;
}
export function formatRiskReward(value, digits = 2) {
  const reward = parseRiskReward(value);
  return reward === null ? null : "1:" + reward.toFixed(digits);
}
export function parseCandidateStrength(value) {
  if (value === null || value === undefined) return null;
  const match = String(value).trim().match(/^(\\d+(?:\\.\\d+)?)\\s*\\/\\s*(\\d+(?:\\.\\d+)?)(?:\\s*\\/\\s*(\\d+(?:\\.\\d+)?)\\s*%)?$/);
  if (!match) return null;
  const score = Number(match[1]), maxScore = Number(match[2]);
  const evidenceCoveragePct = match[3] === undefined ? null : Number(match[3]);
  if (![score, maxScore].every(Number.isFinite) || maxScore <= 0 || score < 0 || score > maxScore ||
      (evidenceCoveragePct !== null && (!Number.isFinite(evidenceCoveragePct) || evidenceCoveragePct < 0 || evidenceCoveragePct > 100))) return null;
  return { score, maxScore, evidenceCoveragePct, label: "Candidate strength", interpretation: "Heuristic points, not trade probability" };
}
