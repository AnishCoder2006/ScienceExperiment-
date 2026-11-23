import { Dashboard } from "@/components/Dashboard";
import type { ResultsFile } from "@/lib/types";
import resultsJson from "@/results.json";

// The saved results are bundled into the page at build time,
// so the 5 diagrams show immediately with no API call.
const results = resultsJson as unknown as ResultsFile;

export default function Home() {
  return <Dashboard saved={results.results} savedAt={results.generatedAt} />;
}
