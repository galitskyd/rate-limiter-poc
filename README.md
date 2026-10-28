# In-Memory API Rate Limiter POC

A dependency-free Node.js proof of concept for enforcing organization and endpoint quotas before application handlers run. It includes configurable standard/premium tiers, stricter write limits, meaningful HTTP 429 responses, deterministic tests, a sample API, and an automated demo.

## Quick start and demo

Prerequisite: Node.js 20 or newer. No package installation is required.

```powershell
npm test
npm start
```

Run the self-contained automated demo (it starts and stops its own temporary server):

```powershell
npm run demo
```

The demo shows an excluded health check, a successful read with `RateLimit-*` headers, then 21 immediate writes; the 21st receives HTTP 429, a JSON explanation naming the endpoint limit, and `Retry-After`. `npm start` is only needed for manual exploration.

The sample server reads `config/rate-limits.json`. To use another file without changing code:

```powershell
$env:RATE_LIMIT_CONFIG = "C:\path\to\rate-limits.json"
npm start
```

Requests identify their organization with `x-org-id`. `org-premium-demo` receives the premium quota; unknown authenticated IDs receive the default standard quota; a missing ID receives the anonymous quota. In a real service, the ID and tier must come from trusted authentication middleware, never directly from an untrusted client header.

## Project map

- `config/rate-limits.json` — tiers, client overrides, read/write policies, exclusions, and cleanup intervals.
- `src/rate-limiter.js` — token-bucket store and coordinated multi-limit decision.
- `src/middleware.js` — reusable HTTP middleware and 429 response contract.
- `src/server.js` — minimal integration with read, write, and health routes.
- `test/rate-limiter.test.js` — deterministic unit and middleware-contract tests.
- `scripts/demo.js` — repeatable demo for the video walkthrough.
- `VIDEO_OUTLINE.md` — timed, speakable recording guide.

## Section A — Architecture & Trade-offs

The POC uses an in-memory token bucket for each enforced dimension. Every bucket has a capacity (the allowed burst) and a refill rate (the sustained request rate). A standard organization receives 100 tokens and refills at 100 per minute; premium receives 500 and refills at 500 per minute. A second bucket is selected by HTTP method and endpoint: reads allow 120 per minute while writes allow 20. A request must pass both its organization bucket and its method/endpoint bucket. This composition prevents a client from staying under its total quota while overwhelming an expensive write path. Configuration is JSON loaded at startup, so operators can adjust tiers, client overrides, endpoint policies, exclusions, and cleanup timing without editing source code. A restart is currently required to reload it.

Token bucket was chosen over a fixed window because it avoids the sharp reset boundary that can permit nearly twice the intended traffic around a minute change. It also produces a precise `Retry-After` from the refill rate and uses constant memory per active bucket. The intentional trade-off is controlled bursting: a full 100-token bucket can be spent immediately. That is useful for normal SaaS sync workloads, but a no-burst policy would need a smaller capacity or a leaky-bucket/GCRA design.

The most important correctness detail is a two-phase decision. The limiter first inspects every applicable bucket, then debits all of them only when all pass. A naive sequential check-and-debit can consume an organization token before discovering that the endpoint bucket is exhausted. The implementation stays synchronous between inspection and commit, making that decision atomic within a Node event-loop turn. Tests specifically protect this behavior.

The middleware is centralized and runs before route logic. It returns HTTP 429 with the failed limit type, a human-readable message, standard `Retry-After`, and quota headers. Health checks are explicitly excluded. With more time I would add framework route-template integration (so `/users/:id` does not create one bucket per raw URL), hot configuration reload with validation and rollback, structured metrics, load tests, IPv6/proxy-aware fallback identity, and a documented policy for requests whose authenticated organization or tier is missing.

## Section B — Production Readiness Plan

### B1 — Failure Modes & Scaling Plan

A process restart erases every bucket, so all clients receive a fresh burst. That may be acceptable for this proof of concept and during infrequent planned deploys, but it is not a reliable abuse-control boundary. A crash loop or rolling deployment could repeatedly reset quotas. Before production, I would persist the algorithm’s state in a shared low-latency store and decide explicitly whether fail-open or fail-closed behavior is appropriate when that store is unavailable. For most B2B traffic I would fail open briefly, alert, and retain coarse upstream protection at the gateway.

Multiple API instances are the largest correctness gap. Each instance owns independent counters, so a client can multiply its effective allowance by the number of instances; load-balancer routing also makes enforcement inconsistent. I would move the coordinated check-and-debit to Redis using a single Lua script or server-side function so the organization and endpoint buckets update atomically. Keys would have TTLs, use a versioned configuration namespace, and be colocated carefully if Redis Cluster is used. Edge/gateway limits can absorb obvious floods, while the application limiter retains organization-aware policy.

Memory grows with active organizations multiplied by active endpoint keys. The POC prunes idle entries, but high-cardinality raw paths or adversarial IDs can still drive growth between sweeps. Production keys should use authenticated organization IDs and normalized route templates, with maximum key length and cardinality safeguards. I would monitor bucket-map size, process RSS/heap, event-loop delay, eviction count, 429 rate by policy, and distinct active organizations. Map size and heap growth are the earliest direct signals; paging or event-loop delay means detection came too late.

### B2 — Required reasoning question (candidate-authored)

The challenge explicitly requires this answer **without AI assistance**, so it is intentionally not written here. Before submission, replace this paragraph in your own words:

> Describe a scenario where an AI coding assistant gives a plausible but incorrect answer for this problem. What would the incorrect output look like? How would you catch it before acting on it?

Use a scenario you personally understand and can defend. A strong answer names observable incorrect behavior, then explains the test, invariant, calculation, or code review step that would expose it. Do not submit this placeholder.

## Section C — AI Usage Log (Mandatory)

This is a factual draft of this build session. Review it and adjust only where your own decisions differ.

| Interaction | What was asked | What the AI produced | What was kept, changed, or rejected — and why |
|---|---|---|---|
| Requirements extraction | Read the authenticated challenge and prepare everything except the video and final submission. | A requirements checklist covering organization tiers, endpoint limits, middleware placement, 429 behavior, configuration, in-memory constraints, tests, documentation, and the required AI evidence. | Kept as the acceptance criteria. Starting the challenge, uploads, and final submission were rejected because those actions must remain under candidate control. |
| Initial design and implementation | Build a small, defensible POC with no external infrastructure. | Dependency-free Node.js middleware using token buckets, JSON configuration, sample routes, idle cleanup, and tests. | Kept token bucket and centralized middleware. The design was tightened to use a two-phase inspect/commit so a request rejected by its endpoint limit cannot still consume its organization quota. Endpoint keys include method and path so separate endpoints do not silently share one counter. |
| Test and correction pass | Run the suite and verify behavior in the available environment. | Five deterministic tests passed; the first HTTP integration test failed because loopback `fetch` was unavailable in the restricted build environment. | Rejected the environment-dependent test harness, not the middleware behavior. Replaced it with a direct middleware contract test that asserts status, headers, and JSON body without a network socket. The final suite passes all six tests, including partial-charge protection and idle pruning. |

## Known constraints at a glance

- State disappears on restart and is not shared across processes.
- The synchronous two-phase update is atomic only inside one Node process.
- Endpoint keys use raw paths in this framework-free demo; production must use normalized route templates.
- JSON configuration is validated at startup but is not hot-reloaded.
- Client identity is a demo header; production must derive it from trusted authentication context.
- Token bucket permits bounded bursts up to configured capacity.

## Verification checklist

- [x] Per-client configurable standard, premium, anonymous, and override limits
- [x] Per-endpoint read/write policies with stricter writes
- [x] Reusable middleware before route handlers
- [x] HTTP 429, failed limit type, and `Retry-After`
- [x] Configuration outside source code with startup validation
- [x] Minimal read/write/health integration
- [x] Failure-mode and scaling documentation
- [x] Deterministic tests and repeatable demo
- [ ] Candidate writes B2 independently
- [ ] Candidate reviews/personalizes the AI log and video story
- [ ] Candidate records the 8–10 minute video
- [ ] Candidate publishes/uploads/submits
