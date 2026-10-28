import assert from "node:assert/strict";
import { test } from "node:test";
import { validateConfig } from "../src/config.js";
import { createRateLimitMiddleware } from "../src/middleware.js";
import { RateLimiter, TokenBucketStore } from "../src/rate-limiter.js";

function config(overrides = {}) {
  return validateConfig({
    defaultTier: "standard",
    tiers: {
      anonymous: { capacity: 1, refillPerSecond: 0.1 },
      standard: { capacity: 2, refillPerSecond: 0.5 },
      premium: { capacity: 4, refillPerSecond: 1 }
    },
    clients: { premium: { tier: "premium" } },
    endpointPolicies: [
      { name: "writes", methods: ["POST"], limit: { capacity: 1, refillPerSecond: 0.25 } },
      { name: "reads", methods: ["GET"], limit: { capacity: 10, refillPerSecond: 10 } }
    ],
    excludedPaths: ["/health"],
    idleEntryTtlSeconds: 60,
    sweepIntervalSeconds: 10,
    ...overrides
  });
}

function setup(customConfig = config()) {
  let now = 0;
  const store = new TokenBucketStore({ now: () => now });
  const limiter = new RateLimiter(customConfig, { store });
  return { limiter, store, advance: (ms) => { now += ms; } };
}

test("standard and premium clients receive different organization quotas", () => {
  const standard = setup();
  assert.equal(standard.limiter.check({ clientId: "standard", method: "GET", path: "/api" }).allowed, true);
  assert.equal(standard.limiter.check({ clientId: "standard", method: "GET", path: "/api" }).allowed, true);
  const denied = standard.limiter.check({ clientId: "standard", method: "GET", path: "/api" });
  assert.equal(denied.allowed, false);
  assert.equal(denied.limitType, "client");
  assert.equal(denied.retryAfterSeconds, 2);

  const premium = setup();
  for (let i = 0; i < 4; i += 1) {
    assert.equal(premium.limiter.check({ clientId: "premium", method: "GET", path: "/api" }).allowed, true);
  }
  assert.equal(premium.limiter.check({ clientId: "premium", method: "GET", path: "/api" }).allowed, false);
});

test("write endpoint quota is stricter and returns a retry time", () => {
  const { limiter, advance } = setup();
  assert.equal(limiter.check({ clientId: "org", method: "POST", path: "/api/widgets" }).allowed, true);
  const denied = limiter.check({ clientId: "org", method: "POST", path: "/api/widgets" });
  assert.equal(denied.allowed, false);
  assert.equal(denied.limitType, "endpoint");
  assert.equal(denied.retryAfterSeconds, 4);
  advance(4000);
  assert.equal(limiter.check({ clientId: "org", method: "POST", path: "/api/widgets" }).allowed, true);
});

test("a failed endpoint check does not partially consume the client bucket", () => {
  const { limiter } = setup();
  assert.equal(limiter.check({ clientId: "org", method: "POST", path: "/api" }).allowed, true);
  assert.equal(limiter.check({ clientId: "org", method: "POST", path: "/api" }).allowed, false);
  // One client token remains because the rejected POST was not partially charged.
  assert.equal(limiter.check({ clientId: "org", method: "GET", path: "/api" }).allowed, true);
});

test("excluded health route does not create or consume buckets", () => {
  const { limiter, store } = setup();
  assert.equal(limiter.check({ clientId: "org", method: "GET", path: "/health" }).allowed, true);
  assert.equal(store.buckets.size, 0);
});

test("idle buckets are pruned", () => {
  const { limiter, store, advance } = setup();
  limiter.check({ clientId: "org", method: "GET", path: "/api" });
  assert.equal(store.buckets.size, 2);
  advance(61_000);
  assert.equal(store.prune(60_000), 2);
});

test("middleware produces a meaningful 429 response and Retry-After header", () => {
  const { limiter } = setup();
  const middleware = createRateLimitMiddleware(limiter);
  const request = { method: "POST", url: "/api/widgets", headers: { "x-org-id": "org" } };
  const response = () => ({
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = String(value); },
    end(body = "") { this.body = body; }
  });
  const first = response();
  middleware(request, first, () => first.end("ok"));
  assert.equal(first.statusCode, 200);

  const denied = response();
  middleware(request, denied, () => denied.end("ok"));
  assert.equal(denied.statusCode, 429);
  assert.equal(denied.headers["retry-after"], "4");
  assert.deepEqual(JSON.parse(denied.body), {
    error: "rate_limit_exceeded",
    message: "Request rejected by writes endpoint quota for org",
    limitType: "endpoint",
    retryAfterSeconds: 4
  });
});
