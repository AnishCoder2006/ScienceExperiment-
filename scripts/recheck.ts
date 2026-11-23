// Re-run the checks on the SVGs already saved in results.json. No API call.
//   npm run recheck            -> print old vs new check results
//   npm run recheck -- --write -> also save the new check results
// Useful after changing a check: you see its effect on the real diagrams in seconds.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { runChecks } from "../lib/checks";
import { getConcept } from "../lib/concepts";
import type { ResultsFile } from "../lib/types";

const RESULTS_PATH = path.join(process.cwd(), "results.json");
const file: ResultsFile = JSON.parse(readFileSync(RESULTS_PATH, "utf8"));
const write = process.argv.includes("--write");
let changed = 0;

for (const result of file.results) {
  const concept = getConcept(result.conceptId);
  if (!concept) continue;
  const { checks } = runChecks(result.svg, concept);
  console.log(`\n${result.conceptId}. ${result.concept}`);
  for (const check of checks) {
    const before = result.checks.find((c) => c.id === check.id)?.passed;
    const flag = before === check.passed ? "" : `  (was ${before ? "pass" : "fail"})`;
    if (flag) changed++;
    console.log(`  ${check.passed ? "✓" : "✗"} ${check.label}: ${check.detail}${flag}`);
  }
  if (write) {
    result.checks = checks;
    result.status = checks.every((c) => c.passed) ? "pass" : "fail";
  }
}

console.log(`\n${changed} check result(s) changed.`);
if (write) {
  writeFileSync(RESULTS_PATH, JSON.stringify(file, null, 2) + "\n");
  console.log("Saved new check results to results.json.");
}
