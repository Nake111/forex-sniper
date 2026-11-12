import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { buildPaperPerformance } from "../src/paper-performance.js";

const journalPath = process.env.PAPER_JOURNAL_PATH ?? "data/second-brain.jsonl";
let events = [];
try {
  const raw = await readFile(journalPath, "utf8");
  events = raw.split("\\n").filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch { throw new Error("Invalid paper journal JSON at line " + (index + 1) + "; refusing performance publication"); }
  });
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}
const report = buildPaperPerformance(events);
await mkdir("dashboard/data", { recursive: true });
const destination = "dashboard/data/paper-performance.json";
const temporary = destination + ".tmp";
await writeFile(temporary, JSON.stringify(report, null, 2) + "\\n");
await rename(temporary, destination);
console.log("PAPER PERFORMANCE PUBLISHED:", destination);
console.log("Resolved:", report.totals.resolved, "| Pending:", report.totals.pending,
  "| Win rate:", report.totals.winRatePct ?? "n/a",
  "| Avg net R:", report.totals.averageNetEstimatedR ?? "n/a");
