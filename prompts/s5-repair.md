# Repair a take-home package

A package you generated has failed verification. It is already written to your working
directory. **Fix it in place** — edit the files that are wrong. Do not start over, and do not
rewrite files that have nothing to do with the failures.

## What failed

{{FAILURES}}

## The package as it stands

{{FILE_LISTING}}

Read the files involved before changing anything. The failures reference real paths and real
test names; find them.

## How to fix it

**By far the most common cause is a test that asserts something the implementation does not
actually do.** The suite was written alongside the code and never executed, so it describes
what the author intended rather than what was built. When a test fails, decide which side is
wrong:

- If the **implementation** is missing behaviour the brief promises, implement it.
- If the **test** asserts something the implementation was never meant to do, or asserts it
  imprecisely — a query that matches several elements, an element expected absent that always
  renders, a condition described but never wired — fix the test.

Prefer the smaller, more certain change. A test you cannot run is a test you can get wrong
again, so make assertions simple and obviously true of the code in front of you.

## Rules that still apply

These were true when the package was generated and are still true now:

- **Every file must remain freshly written.** Never copy from the source repository, and do
  not paste from it while fixing. An automated check rejects any run of 8 or more lines that
  matches it, and a repair has already failed this way once.
- **The starter's own tests must pass.** That is usually what you are fixing.
- {{ARCHETYPE_RULE}}
- One command installs, one command runs the tests, and no external services are involved.
- Nothing in `candidate/` may reveal the answer or mention how the package was produced.

## When you are done

Reply with a single JSON object and nothing else:

```
{
  "files": ["candidate/src/services/booking.ts", "candidate/test/booking.test.ts"],
  "setupCommand": "npm install",
  "testCommand": "npm test",
  "notes": "what you changed and why"
}
```

`files` lists only the files you **changed**. `setupCommand` and `testCommand` must match what
the package actually uses — repeat them even if you did not change them.
