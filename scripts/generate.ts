// Part A from the command line.
//   npm run generate                 -> all 5 concepts
//   npm run generate -- --concept 3  -> only concept 3 (comma list allowed: 1,4)
// Results are merged into results.json after every concept, so a crash keeps earlier work.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CONCEPTS } from "../lib/concepts";
import { generateDiagram } from "../lib/pipeline";
import type { DiagramResult, ResultsFile } from "../lib/types";

// Load GEMINI_API_KEY from .env.local (git-ignored). Never hard-code the key.
for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const RESULTS_PATH = path.join(process.cwd(), "results.json");
/** Small pause between concepts to stay under the free tier's requests-per-minute limit. */
const PAUSE_MS = 3000;

function selectedConcepts() {
  const i = process.argv.indexOf("--concept");
  if (i === -1) return CONCEPTS;
  const ids = (process.argv[i + 1] ?? "").split(",").map(Number);
  const chosen = CONCEPTS.filter((c) => ids.includes(c.id));
  if (chosen.length === 0) {
    console.error(`Unknown concept "${process.argv[i + 1]}". Use 1-${CONCEPTS.length}.`);
    process.exit(1);
  }
  return chosen;
}

function save(results: Map<number, DiagramResult>) {
  const file: ResultsFile = {
    generatedAt: new Date().toISOString(),
    results: [...results.values()].sort((a, b) => a.conceptId - b.conceptId),
  };
  writeFileSync(RESULTS_PATH, JSON.stringify(file, null, 2) + "\n");
}

async function main() {
  const existing: ResultsFile = existsSync(RESULTS_PATH)
    ? JSON.parse(readFileSync(RESULTS_PATH, "utf8"))
    : { generatedAt: "", results: [] };
  const results = new Map(existing.results.map((r) => [r.conceptId, r]));

  const concepts = selectedConcepts();
  let failures = 0;
  for (const [index, concept] of concepts.entries()) {
    console.log(`\n=== ${concept.id}. ${concept.name} (${concept.subject}) ===`);
    try {
      const result = await generateDiagram(concept, {
        onEvent: (e) => {
          if (e.type === "status") console.log(`  … ${e.message}`);
          if (e.type === "attempt") {
            console.log(`  attempt ${e.attempt}: ${e.failed.length ? `failed ${e.failed.join(", ")}` : "all checks passed"}`);
          }
        },
      });
      results.set(concept.id, result);
      save(results);
    } catch (e) {
      failures++;
      console.error(`  ERROR: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (index < concepts.length - 1) await new Promise((r) => setTimeout(r, PAUSE_MS));
  }

  // Summary table: concept, pass/fail, cost, retries.
  const all = [...results.values()].sort((a, b) => a.conceptId - b.conceptId);
  console.log("\nSummary");
  console.table(
    all.map((r) => ({
      concept: r.concept,
      status: r.status,
      model: r.model,
      inputTokens: r.usage.inputTokens,
      outputTokens: r.usage.outputTokens,
      costUsd: r.costUsd,
      retries: r.retries.total,
      failedChecks: r.checks.filter((c) => !c.passed).map((c) => c.label).join(", ") || "-",
    })),
  );
  const total = all.reduce((s, r) => s + r.costUsd, 0);
  console.log(`Total estimated cost: $${total.toFixed(6)}. Saved to ${RESULTS_PATH}`);
  if (failures) process.exit(1);
}

main();
