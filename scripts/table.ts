// Print the README results table (Markdown) from results.json, so the README always
// matches the real run.   npm run table

import { readFileSync } from "node:fs";
import path from "node:path";
import { formatUsd } from "../lib/format";
import type { ResultsFile } from "../lib/types";

const file: ResultsFile = JSON.parse(readFileSync(path.join(process.cwd(), "results.json"), "utf8"));

const rows = file.results.map((r) => {
  const failed = r.checks.filter((c) => !c.passed).map((c) => c.label);
  const firstTry = r.attempts[0]?.checks.filter((c) => !c.passed).map((c) => c.label) ?? [];
  return [
    `${r.conceptId}. ${r.concept}`,
    r.status === "pass" ? "✅ pass" : `❌ fail (${failed.join(", ")})`,
    formatUsd(r.costUsd),
    `${r.retries.total} (${r.retries.validation} check, ${r.retries.api} API)`,
    `${r.usage.inputTokens} / ${r.usage.outputTokens}`,
    firstTry.length ? firstTry.join(", ") : "-",
  ];
});

const total = file.results.reduce((s, r) => s + r.costUsd, 0);
console.log("| Concept | Result | Est. cost | Retries | Tokens in / out | Failed on first try |");
console.log("|---|---|---|---|---|---|");
for (const row of rows) console.log(`| ${row.join(" | ")} |`);
console.log(`| **Total** | | **${formatUsd(total)}** | | | |`);
const models = [...new Set(file.results.map((r) => r.model))].join(", ") || "-";
console.log(`\nModels: ${models} · generated ${file.generatedAt}`);
