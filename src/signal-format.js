export function parseRiskReward(value) {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : null;
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  const colon = text.indexOf(":");
  const slash = text.indexOf("/");
  let rewardText = text;
  if (colon >= 0) {
    if (text.slice(0, colon).trim() !== "1") return null;
    rewardText = text.slice(colon + 1).trim();
  } else if (slash >= 0) {
    if (text.slice(0, slash).trim() !== "1") return null;
    rewardText = text.slice(slash + 1).trim();
  }
  const reward = Number(rewardText);
  return Number.isFinite(reward) && reward > 0 ? reward : null;
}

export function formatRiskReward(value, digits = 2) {
  const reward = parseRiskReward(value);
  return reward === null ? null : "1:" + reward.toFixed(digits);
}

export function parseCandidateStrength(value) {
  if (value === null || value === undefined) return null;
  const parts = String(value).split("/");
  if (parts.length < 2 || parts.length > 3) return null;
  const score = Number(parts[0].trim());
  const maxScore = Number(parts[1].trim());
  let evidenceCoveragePct = null;
  if (parts.length === 3) {
    const coverageText = parts[2].trim();
    evidenceCoveragePct = Number(coverageText.endsWith("%") ? coverageText.slice(0, -1).trim() : coverageText);
  }
  if (!Number.isFinite(score) || !Number.isFinite(maxScore) || maxScore <= 0 ||
      score < 0 || score > maxScore ||
      (evidenceCoveragePct !== null && (!Number.isFinite(evidenceCoveragePct) || evidenceCoveragePct < 0 || evidenceCoveragePct > 100))) {
    return null;
  }
  return {
    score, maxScore, evidenceCoveragePct,
    label: "Candidate strength",
    interpretation: "Heuristic points, not trade probability"
  };
}
