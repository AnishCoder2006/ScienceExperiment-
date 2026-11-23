# Science Diagram Maker

A small web app that asks Gemini for 5 animated GCSE science diagrams (SVG), checks each one in code, retries once with the reasons when a check fails, and lets a reviewer approve or reject each diagram.

**Live app:** _add the Vercel link here_

---

## Run it on your computer

You need Node.js 20 or newer and a free Gemini API key from [aistudio.google.com/api-keys](https://aistudio.google.com/api-keys).

```bash
npm install
cp .env.example .env.local     # then put your key in .env.local
npm run generate               # Part A: makes results.json for all 5 concepts
npm run dev                    # Part B: open http://localhost:3000
```

`.env.local` is git-ignored. The key is only read from the environment and is sent to Google in a request header, never in a URL or a log.

| Command | What it does |
|---|---|
| `npm run generate` | Generates all 5 diagrams and writes `results.json`. Add `-- --concept 3` for one concept. |
| `npm run recheck` | Re-runs the checks on the saved SVGs with no API call. Add `-- --write` to save the new results. |
| `npm run table` | Prints the results table below from `results.json`. |
| `npm test` | 42 offline tests for the checks, the retry logic and the API error handling. |
| `npm run typecheck` / `npm run lint` | TypeScript and ESLint. |

### Deploy (Vercel)

1. Push the repo to GitHub and import it in Vercel. No build settings are needed.
2. In Project Settings → Environment Variables, add `GEMINI_API_KEY` (your key) and `GEMINI_MODEL` = `gemini-3.5-flash-lite`. Flash-lite answers in seconds; `gemini-3.5-flash` can take 2 minutes.
3. Deploy. The page is static and works even if the key is missing. Only the Generate button needs the key.

---

## How it works

### Part A: generation pipeline

| File | Role |
|---|---|
| `lib/concepts.ts` | The 5 concepts, the text from the brief and the key terms for our own check. |
| `lib/prompt.ts` | System prompt that lists the rules the code checks, plus the retry message. |
| `lib/gemini.ts` | Calls the Gemini REST API with `fetch`. Handles retries, timeouts and readable errors. |
| `lib/checks/` | The SVG checks: `index.ts` runs them, `bounds.ts`, `geometry.ts` and `styles.ts` power the viewBox check. |
| `lib/pipeline.ts` | One concept end to end: call, check, retry once with feedback, keep the best attempt, log. |
| `scripts/generate.ts` | Runs the pipeline for every concept and saves `results.json`. |

For each concept:

1. Send the concept text to the model once and extract the `<svg>…</svg>` from the reply.
2. Run all 6 checks.
3. If any check fails, ask again once. The retry is a conversation: the model sees its own SVG, then a list of the failed checks with the exact reasons. For example: `Inside viewBox: <text> "Glucose": right edge at x=812 (max 800)`.
4. Keep the attempt with the fewest failed checks.
5. Log model, input tokens, output tokens, estimated cost, retries and every check result. This goes to the console and into `results.json`, including the feedback that was sent.

**API errors.** A 429 or 503 response, or a network timeout, is retried up to 3 times. The wait is the `retryDelay` Gemini returns, or 2s, 4s, 8s plus jitter. If Gemini asks for more than 60 seconds, the daily quota is probably used up, so we stop with a clear message. Errors such as 400 for a bad key or 404 for an unknown model are not retried and get a readable message.

### The checks

| Check | How it works |
|---|---|
| **Valid SVG** | Strict XML parse with `@xmldom/xmldom`. Any parser error fails, because browsers refuse to draw broken XML. The root must be `<svg>` with the SVG namespace, which `<img>` needs, and a viewBox of 4 numbers. |
| **Inside viewBox** | Walks the element tree and multiplies transform matrices. It computes boxes for rect, circle, ellipse, line, polyline, polygon, path and text. The path parser samples Bézier curves and arcs. It also follows SMIL motion: `animateTransform` keyframes, `animateMotion` paths and `<animate>` on x, y, cx, cy and r. A shape that is only outside mid-animation is caught too. A base position that a never-ending animation replaces from the first frame is skipped, because it is never on screen. |
| **Title + 3 labels** | A non-empty `<title>` that is a direct child of `<svg>`, and at least 3 non-empty `<text>` elements. |
| **Animated** | A SMIL element with a duration above 0, or CSS `@keyframes` that an element actually uses. An `<animate>` without `dur` does nothing, so it fails. |
| **Key terms labelled** *(own check)* | The labels must contain the GCSE terms for the concept, such as hypotenuse and a² + b² = c², or chlorophyll, glucose and CO₂. A diagram can be valid SVG and still teach nothing. This catches that. |
| **Safe to embed** *(own check)* | No `<script>`, no `on*` handlers, no `foreignObject` and no external URLs. The page also renders every diagram inside `<img>`, where scripts never run, as a second layer. |

### Part B: the page

- `app/page.tsx` imports `results.json` at build time, so the 5 saved diagrams show immediately with **no API call**.
- The table shows the animated diagram, pass or fail for each check (hover for the reason), cost, tokens and retries split into check retries and API retries.
- **Generate** calls `POST /api/generate`. The route streams progress as NDJSON, so the reviewer sees each step, such as "Attempt 1 failed: Inside viewBox". Errors appear as a red message in that row, never a blank page. The route stops itself before Vercel's time limit and returns a clear error.
- **Details** opens a dialog with every attempt, its tokens and cost, the feedback sent to the model, and the SVG source with copy and download buttons.

### Where Approve / Reject is saved, and why

**Choice: the browser's localStorage.**

- It needs no extra infrastructure. The link cannot break because a database is down or a free tier expired. A dead link means instant rejection, so fewer moving parts is safer.
- Vercel's filesystem is not persistent, so "a file on the server" would not survive a redeploy or a cold start.
- The trade-off: decisions belong to one browser. Two reviewers on two laptops do not see each other's choices. For a real team I would use a small database instead (see "one more day").

Decisions and notes survive a refresh and stay in sync across tabs. Diagrams generated live are also kept in localStorage, with a "Revert to saved" button. Every storage access is wrapped in try/catch, so a private window still renders the page.

### Cost

Costs are **estimates at paid-tier prices**. On the free tier the real bill is $0. Thinking tokens are billed as output.

| Model | Input / 1M tokens | Output / 1M tokens |
|---|---|---|
| gemini-3.5-flash-lite (used) | $0.30 | $2.50 |
| gemini-3.5-flash | $1.50 | $9.00 |

These prices come from third-party price listings in November 2026 that quote Google's pricing page. I could not load Google's own table, so check [ai.google.dev/pricing](https://ai.google.dev/pricing). They live in `lib/pricing.ts`.

---

## Results

From the saved run in `results.json`, printed with `npm run table`:

| Concept | Result | Est. cost | Retries | Tokens in / out | Failed on first try |
|---|---|---|---|---|---|
| 1. Pythagoras' theorem | ✅ pass | $0.0997 | 0 (0 check, 0 API) | 506 / 10988 | - |
| 2. Parts of a circle | ✅ pass | $0.0080 | 2 (1 check, 1 API) | 2527 / 2910 | Inside viewBox |
| 3. Series circuit | ✅ pass | $0.0110 | 6 (1 check, 5 API) | 3202 / 4024 | Inside viewBox |
| 4. Photosynthesis | ✅ pass | $0.0058 | 0 (0 check, 0 API) | 489 / 2247 | - |
| 5. States of matter | ✅ pass | $0.0070 | 1 (0 check, 1 API) | 486 / 2731 | - |
| **Total** | | **$0.1314** | | | |

- **Two models.** Pythagoras was made with `gemini-3.5-flash`. The other four were made with `gemini-3.5-flash-lite`. Both are the free models the brief suggests. Why there are two is explained under "What failed" below.
- **Pythagoras costs the most** because `gemini-3.5-flash` "thinks" before answering: 7,333 of its 10,988 output tokens were thinking tokens, which are billed as output.
- **Series circuit** was saved as a fail and turned into a pass after I fixed a false alarm in my own viewBox check (see below). I re-ran the checks on the saved SVG with `npm run recheck`, with no new API call. The attempt log in `results.json` still shows the original check results from generation time.

---

## What failed, and how I fixed it

1. **Gemini was overloaded (503).** For about half an hour, every diagram request to `gemini-3.5-flash-lite` returned "This model is currently experiencing high demand", even after the 3 backoff retries (2 s, 4 s, 8 s). A tiny "Say hi" request with the same key worked, so the key was fine and the problem was capacity on Google's side. The code did what the brief asks: it retried 3 times and then stopped with a clear message instead of hanging. To get the diagrams made, I ran the concepts one at a time with a minute's pause between tries. The API retries in the table come from these errors.
2. **`gemini-3.5-flash` was too slow for my timeouts.** One diagram took about 2 minutes, and my request timeout was 90 seconds. I raised it to 180 seconds. I also raised the `/api/generate` route limit to 300 seconds, the most Vercel's free plan allows, with a 290-second budget of its own, so the reviewer sees a clear error rather than a cut connection.
3. **The free daily quota for `gemini-3.5-flash` ran out (429)** after a few long calls. Gemini asked us to wait about 14 hours. The client never waits longer than 60 seconds; it stops with "The free daily limit may be used up" instead. The remaining concepts were made with `gemini-3.5-flash-lite` once it recovered, and the live site uses flash-lite because it is faster.
4. **Parts of a circle went outside the picture.** The first attempt drew a circle whose bottom edge was at y=540 when the viewBox ends at 500. The viewBox check caught it, the retry told the model exactly that, and the second attempt passed. This is the check-and-retry loop working as designed.
5. **My own viewBox check gave a false alarm on Series circuit.** The moving "current" dots had no `cx`, so their base position was x=0, half outside the picture. But their `<animate>` on `cx` starts on the first frame and repeats forever, so x=0 is never on screen. The check counted the base position anyway. The retry could not fix it, because there was nothing wrong to fix. The check now ignores a base value that an animation replaces from the first frame and never lets go (`begin` of 0 or less, plus `repeatCount="indefinite"` or `fill="freeze"`). A delayed animation still counts the base position. An earlier Series circuit attempt really did this: dots with `begin="1s"` sat in the top-left corner for a second before moving, which a student would see. I added 2 tests for both cases.
6. **A key in the wrong file.** Early on, the real API key was put in `.env.example`, which is committed. I caught it before the first push, removed that commit and moved the key to `.env.local`, which is git-ignored. The key was never on GitHub.

### Local setup notes (Windows)

- Run `npm run dev` from PowerShell or the normal VS Code terminal, not WSL. `node_modules` installed on Windows has no Linux build of `lightningcss`, so WSL fails with "Cannot find module '../lightningcss.linux-x64-gnu.node'".
- Run the tests from `D:\…` with a capital drive letter. From `d:\…`, Vitest loads itself twice and every suite fails with "failed to find the current suite".
- In PowerShell, `npm run recheck -- --write` can lose the `--write` flag. Use `npx tsx scripts/recheck.ts --write` instead.

### Problems I designed the checks around

These were planned for while building the checks, before any real run:

- **Unclosed XML and HTML entities.** `&nbsp;` is valid HTML but not valid XML, and browsers refuse to draw such an SVG. The validity check treats every parser message as a failure, and the prompt tells the model to type characters such as ² directly.
- **SVGs that render as nothing.** Without `xmlns="http://www.w3.org/2000/svg"`, an SVG shows as blank inside `<img>`. This is now part of the validity check.
- **Labels split by superscripts.** `a<tspan>2</tspan>` reads as "a2" and `a²` as "a²", so the key-term check normalises ², ₂ and `^2` before matching.

## Known limitations

- Text width is estimated from font size and character type, not measured, so a label can be off by a few units. The tolerance is 2 units.
- Motion from CSS `@keyframes` is not simulated by the viewBox check. Only SMIL motion is, so the prompt asks for SMIL.
- `clip-path` is ignored, so a shape that is clipped back inside the viewBox would still be reported.
- The Generate endpoint has no rate limit. The UI allows one run at a time, but a script could still use up the free quota.

## What I would do with one more day

- Render each SVG in a headless browser and use real `getBBox()` values for an exact viewBox check, including CSS animation.
- Add a second model pass that looks at a rendered PNG and grades scientific correctness, such as current direction or particle spacing.
- Move reviews to a small database such as Upstash Redis or Postgres, with reviewer name and history, so a team shares decisions.
- Rate-limit `/api/generate` per IP, and cache the system prompt to cut input tokens.
- Generate 2 or 3 candidates per concept in parallel and keep the best, which costs little with flash-lite.

## AI tools used

- **Claude Code (Claude Opus)**: planned the architecture with me and wrote most of the code and tests. It also helped debug the Gemini 503 and 429 errors and the slow-model timeouts, found and fixed the false alarm in the viewBox check, redesigned the page, and drafted this README. I reviewed the code and can explain each part.
