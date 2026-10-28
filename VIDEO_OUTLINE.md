# 8–10 Minute Video Walkthrough Outline

This is a speaking guide, not a script. Read the code, run the demo, and explain it in your own words. Target about 9 minutes.

## 0:00–1:00 — Problem and approach

- “One client’s sync job consumed 40% of shared API capacity. The goal is to reject excess traffic before application logic while preserving fair access for other organizations.”
- State the constraints: in-memory only, middleware pattern, configurable organization and endpoint limits, useful 429 responses.
- Summarize the approach: dependency-free Node middleware, token buckets, JSON policy, two simultaneous dimensions, sample routes, six tests.
- Explain why token bucket: smooth refill avoids fixed-window boundary spikes, supports normal bursts, and makes `Retry-After` calculable.

## 1:00–4:15 — Code walkthrough

1. Show `config/rate-limits.json`.
   - Standard 100/minute, premium 500/minute, anonymous 20/minute.
   - Writes 20/minute versus reads 120/minute.
   - Point out client overrides and `/health` exclusion.
2. Show `src/rate-limiter.js`.
   - `TokenBucketStore` refills from elapsed time and keeps constant state per bucket.
   - The request builds an organization bucket and an endpoint bucket keyed by organization, method, and path.
   - Highlight inspect-all, then commit-all. Say why partial charging is a correctness bug.
3. Show `src/middleware.js`.
   - Identity comes from `x-org-id` only for the demo; trusted auth context is required in production.
   - Allowed requests call `next()`; denied requests stop before handlers and return 429, limit type, quota headers, and `Retry-After`.
4. Show `src/server.js`.
   - Minimal GET/POST widget routes and excluded health route demonstrate integration without modifying each handler.

## 4:15–5:15 — Live demo and tests

- Run `npm test`; point out six passing tests.
- Mention the two highest-value tests:
  - stricter write policy and computed retry time;
  - rejected endpoint request does not consume the remaining organization token.
- Run the server and `npm run demo` in another terminal.
- Show health success, read quota headers, then the 21st immediate write returning 429 and `Retry-After`.

## 5:15–7:10 — Failure modes and production scaling

- Restart: quotas reset, allowing a fresh burst. Fine for a POC, unsafe as the sole production control.
- Horizontal scaling: every instance has independent state, multiplying effective limits and creating inconsistent decisions.
- Migration: Redis with one Lua script/server-side function to atomically inspect and debit both keys; TTLs prevent abandoned state. Keep gateway limits for coarse flood protection.
- Memory: active organizations × active endpoints. Idle pruning helps, but raw dynamic URLs or untrusted IDs can explode cardinality. Use authenticated IDs and route templates such as `/users/:id`.
- Monitor map/key count, heap/RSS, event-loop delay, 429s by policy, and active organizations.
- Discuss fail-open versus fail-closed; choose briefly failing open for ordinary B2B traffic plus alerts and gateway protection, unless the endpoint is security- or cost-critical.

## 7:10–8:30 — Mandatory AI collaboration question

Do not claim a disagreement you did not have. A defensible moment available for you to verify during review is the sequential-versus-two-phase quota update:

- Specific issue: a plausible naive implementation checks and immediately decrements the organization bucket, then checks the endpoint bucket.
- Why it misses the bar: when the endpoint is exhausted, the rejected request still spends an organization token. The two limits no longer compose fairly.
- Redirection: require an inspect-all/commit-all invariant with no asynchronous gap, then add a regression test proving a rejected POST leaves a token available for a GET.
- Why: correctness should be stated as an invariant and protected by a test, not assumed from locally reasonable helper methods.

Only present this as your pushback if you personally review the sequential alternative, understand the failure, and make that decision. Otherwise replace it with a real moment from your own review or follow-up conversation with the AI.

## 8:30–9:15 — What I would change with more time

- Normalize framework route templates rather than raw paths.
- Add live config reload with validation, versioning, and rollback.
- Add metrics/tracing, concurrency and load tests, proxy-aware identity, and policy-specific failure behavior.
- Package adapters for the team’s real framework and add a Redis-backed store behind the same interface.

## Before recording

- Replace the README B2 placeholder entirely in your own words without AI assistance.
- Review and personalize the AI usage log; do not imply decisions you did not make.
- Practice the demo once so the server is already running and the output is predictable.
- Keep the recording natural; use this outline as landmarks rather than reading it aloud.
