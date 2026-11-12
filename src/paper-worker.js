import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const intervalMs = Math.max(60_000, Number(process.env.PAPER_CYCLE_INTERVAL_MS ?? 300_000));
const port = Number(process.env.PORT ?? 8080);
const feedUrl = `http://127.0.0.1:${port}`;
let stopping = false;

function runNode(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], { stdio: "inherit", env: process.env });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${script} exited with code ${code} signal ${signal ?? "none"}`));
    });
  });
}

async function reportJournalHealth(phase) {
  try {
    const response = await fetch(feedUrl + "/journal-health", { signal: AbortSignal.timeout(3_000) });
    const status = await response.json();
    console.log(`PAPER JOURNAL HEALTH [${phase}]:`, JSON.stringify(status));
  } catch (error) {
    console.warn(`PAPER JOURNAL HEALTH CHECK FAILED [${phase}]:`, error.message);
  }
}

async function waitForFeed() {
  for (let attempt = 1; attempt <= 60 && !stopping; attempt++) {
    try {
      const response = await fetch(feedUrl + "/health", { signal: AbortSignal.timeout(2_000) });
      if (response.ok) {
        console.log("REALTIME FEED HEALTHY:", feedUrl);
        return;
      }
    } catch {}
    await delay(1_000);
  }
  throw new Error("Realtime quote feed did not become healthy within 60 seconds");
}

const feed = spawn(process.execPath, ["src/realtime-feed.js"], { stdio: "inherit", env: process.env });
feed.once("error", error => {
  console.error("Realtime feed process failed:", error);
  process.exit(1);
});
feed.once("exit", (code, signal) => {
  if (!stopping) {
    console.error("Realtime feed stopped unexpectedly:", code, signal);
    process.exit(1);
  }
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopping = true;
    feed.kill(signal);
  });
}

async function main() {
  console.log("FOREX SNIPER PAPER WORKER STARTED", JSON.stringify({
    mode: "PAPER / RESEARCH ONLY",
    dataDirectory: process.env.DATA_DIR ?? "data",
    journalPath: process.env.PAPER_JOURNAL_PATH ?? "data/second-brain.jsonl",
    intervalMs
  }));
  await waitForFeed();
  await reportJournalHealth("startup-recovery");
  while (!stopping) {
    const cycleStartedAt = Date.now();
    try {
      console.log("PAPER CYCLE: refreshing closed-candle history");
      await runNode("src/download.js");
      console.log("PAPER CYCLE: running multi-market analysis");
      await runNode("src/index.js");
      await reportJournalHealth("after-cycle");
      console.log("PAPER CYCLE COMPLETE:", new Date().toISOString());
    } catch (error) {
      console.error("PAPER CYCLE FAILED CLOSED:", error.message);
      console.error("No trade approval is inferred from a failed cycle.");
    }
    const remaining = Math.max(1_000, intervalMs - (Date.now() - cycleStartedAt));
    if (!stopping) await delay(remaining);
  }
}

main().catch(error => {
  console.error("PAPER WORKER FATAL:", error);
  process.exit(1);
});
