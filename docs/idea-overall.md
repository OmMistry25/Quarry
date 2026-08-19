# Quarry — Overall Idea

> Working name: **Quarry** (the repo is a quarry — we extract patterns, not code). Rename freely.

## One-liner

Point Quarry at a GitHub repo and get a complete, role-specific take-home test: candidate brief, runnable starter repo, grading rubric, and interviewer answer key — generated from the patterns in *your* codebase, without shipping any of your actual code to candidates.

## The problem

Take-home tests are the highest-signal async hiring tool, but writing a good one takes a senior engineer 4–8 hours: pick a realistic task, build a starter repo that installs cleanly, plant the right difficulty, write a rubric, write the answer key. So teams either skip take-homes, reuse a stale one every candidate has seen, or fall back to LeetCode-style questions that don't predict job performance.

## The gap in the market (validated Aug 2026)

- **Assessment platforms** (CodeSubmit, Coderbyte, HackerRank, CodeSignal, TestGorilla, Vervoe) administer take-homes well, but their content comes from question banks or templates "matched to your stack" — none ingest your repo.
- **Repo-aware AI tools** (Claude Code, Cursor, Devin, GitLoop) can deeply read a codebase, but none are hiring products.

Nobody has productized: **your repo → bespoke take-home**. That's the wedge.

## Core insights (from design work, don't relitigate)

1. **Synthesize, don't extract.** Never hand candidates a slice of the real repo (IP leakage, secrets, dependency hell). Read the repo to learn its *stack, domain, patterns, and conventions*, then generate a fresh miniature repo that mirrors them. "No IP leaves your org" is the pitch, not a limitation.
2. **The repo is a quarry, not a model.** We never need to understand the whole repo. We map its components, find 3–5 assessable surfaces for a given role, and ignore the rest.
3. **Role is the primary input.** A component map lets one repo generate tests for multiple roles (backend, frontend, fullstack, data). The tool derives the *supported role menu* from the repo instead of letting users request roles the repo can't support.
4. **Seniority is a scope knob**, not a separate dimension: junior = bug hunt, mid = ticket-style extension, senior = extension + design note.
5. **Verification is the product.** A generated starter repo that doesn't install is a demo toy. Running install + tests in a sandbox before packaging is what makes output sendable.

## Long-term direction (explicitly NOT in MVP)

- **PostHog / analytics integration** — pull real event schemas to generate instrumentation & analytics take-homes. Unique differentiator; nobody else can touch it.
- Submission collection, AI-assisted grading against the generated rubric, calibration against real hire outcomes.
- ATS / assessment-platform export (send package straight into CodeSubmit, Greenhouse, etc.).
- Private-repo OAuth app, team accounts, multi-tenant SaaS.

## Why now

Repo-scale agents (Claude Code / Codex) made the hard part — reading an arbitrary codebase and generating coherent, runnable code in its style — a commodity API call. Two years ago this product required a research team; today it's an orchestration layer plus taste.
