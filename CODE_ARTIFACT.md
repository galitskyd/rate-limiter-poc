# Code Artifact — API Rate Limiter POC

## Artifact contents

The complete working source accompanies this document in the `rate-limiter-poc` project folder. It is a dependency-free Node.js 20+ project.

| Path | Purpose |
|---|---|
| `config/rate-limits.json` | Configurable organization tiers, client overrides, endpoint policies, exclusions, and cleanup timing |
| `src/config.js` | Configuration loading and fail-fast validation |
| `src/rate-limiter.js` | Token-bucket state plus atomic inspect-all/commit-all decision |
| `src/middleware.js` | Reusable middleware and meaningful HTTP 429 response |
| `src/server.js` | Minimal GET/POST/health integration example |
| `test/rate-limiter.test.js` | Six deterministic behavior and response-contract tests |
| `scripts/demo.js` | Repeatable demonstration of allowed and rejected traffic |
| `README.md` | Architecture, trade-offs, production plan, AI log, and runbook |

## Run and verify

```powershell
cd rate-limiter-poc
npm test
npm run demo
npm start
```

Expected verification: all six tests pass. The demo reports HTTP 200 for health and a read request, then HTTP 429 on the 21st immediate write with `limitType: "endpoint"` and a `Retry-After` header.

## Core contract

- Organization policy: anonymous, standard (100/minute), premium (500/minute), and per-client override support.
- Endpoint policy: separate buckets by organization + method + path, with writes at 20/minute and reads at 120/minute.
- Composition: every applicable bucket is inspected first; buckets are debited only if all checks pass.
- Rejection: HTTP 429 JSON identifies the failed dimension and supplies `Retry-After` plus quota headers.
- Middleware: enforcement happens once before handlers, not inside individual routes.
- Configuration: JSON can be replaced via `RATE_LIMIT_CONFIG` without source changes; validation fails fast at startup.

## Submission note

If the platform expects a repository URL rather than an attached folder, publish the `rate-limiter-poc` directory to a repository you control and add that URL here before uploading this Markdown document.
