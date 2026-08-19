# Quarry — Goals

## Primary goal

Validate one question: **would people who hire engineers actually send a Quarry-generated take-home to a real candidate?**

Everything in the MVP exists to answer that. Anything that doesn't serve it gets cut.

## Success metrics

| # | Metric | Target | How measured |
|---|--------|--------|--------------|
| 1 | "Would you send this as-is?" | ≥ 3 of 5 reviewers say yes or "with minor edits" | Show 5 people who hire engineers a generated package; ask the one question |
| 2 | Edit distance | Reviewers estimate < 30 min of edits before sending | Same interviews |
| 3 | End-to-end latency | Repo URL → downloadable package in < 10 min | Timed runs |
| 4 | Verification pass rate | ≥ 70% of generated packages install + pass their own tests on first generation attempt | Logged by the verify stage |
| 5 | Multi-role proof | One monorepo produces credible packages for ≥ 2 different roles | Dogfood runs |

## Demo goals

- Live demo works from a cold start in < 10 min on a repo the audience recognizes.
- The "paste URL → see which roles this repo can assess" moment lands in the first 60 seconds.
- Dogfood targets: `gtm-os-console` and `signal-engine` (Om's repos), plus one well-known OSS repo (e.g., a mid-size Express or Next.js app) so strangers can judge output quality.
- First reviewers: Andrei (CEO), Neal (CTO), plus 3 engineering friends who run hiring loops.

## Learning goals

- Where does generation quality break down? (Repo size? Language? Monorepos? Sparse docs?)
- Which archetype do reviewers trust more — bug hunt or extension?
- Do reviewers care more about the starter repo, the rubric, or the answer key? (Informs what v2 invests in.)

## Non-goals for this phase

- Revenue, pricing, or landing pages.
- Handling every language/stack. TS/JS and Python repos only.
- Private-repo OAuth. Local paths and `GITHUB_TOKEN` env var are enough.
- Any candidate-facing features (submissions, grading, proctoring).
- PostHog integration (v2 — see idea-overall.md).
