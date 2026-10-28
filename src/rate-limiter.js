const EPSILON = 1e-9;

export class TokenBucketStore {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.buckets = new Map();
  }

  #snapshot(key, rule, now) {
    const existing = this.buckets.get(key);
    if (!existing) return { tokens: rule.capacity, lastRefillMs: now, lastSeenMs: now };
    const elapsedSeconds = Math.max(0, now - existing.lastRefillMs) / 1000;
    return {
      tokens: Math.min(rule.capacity, existing.tokens + elapsedSeconds * rule.refillPerSecond),
      lastRefillMs: now,
      lastSeenMs: now
    };
  }

  inspect(key, rule, now = this.now()) {
    const state = this.#snapshot(key, rule, now);
    const allowed = state.tokens + EPSILON >= 1;
    const retryAfterSeconds = allowed
      ? 0
      : Math.max(1, Math.ceil((1 - state.tokens) / rule.refillPerSecond));
    return {
      allowed,
      remaining: Math.max(0, Math.floor(state.tokens - (allowed ? 1 : 0))),
      retryAfterSeconds,
      limit: rule.capacity
    };
  }

  commit(key, rule, now = this.now()) {
    const state = this.#snapshot(key, rule, now);
    if (state.tokens + EPSILON < 1) throw new Error(`Cannot commit exhausted bucket: ${key}`);
    state.tokens = Math.max(0, state.tokens - 1);
    this.buckets.set(key, state);
  }

  prune(idleTtlMs, now = this.now()) {
    let removed = 0;
    for (const [key, state] of this.buckets) {
      if (now - state.lastSeenMs > idleTtlMs) {
        this.buckets.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
}

export class RateLimiter {
  constructor(config, { store = new TokenBucketStore() } = {}) {
    this.config = config;
    this.store = store;
  }

  #clientRule(clientId) {
    if (!clientId) return this.config.tiers.anonymous ?? this.config.tiers[this.config.defaultTier];
    const client = this.config.clients?.[clientId];
    return client?.limit ?? this.config.tiers[client?.tier ?? this.config.defaultTier];
  }

  #endpointPolicy(method, path) {
    const normalized = method.toUpperCase();
    return this.config.endpointPolicies.find((policy) =>
      policy.methods.some((candidate) => candidate.toUpperCase() === normalized) &&
      (!policy.pathPrefix || path.startsWith(policy.pathPrefix))
    );
  }

  check({ clientId, method, path, now = this.store.now() }) {
    if (this.config.excludedPaths?.includes(path)) return { allowed: true, checks: [] };

    const identity = clientId || "anonymous";
    const clientRule = this.#clientRule(clientId);
    const endpointPolicy = this.#endpointPolicy(method, path);
    const candidates = [
      {
        type: "client",
        key: `client:${identity}`,
        rule: clientRule,
        description: `organization quota for ${identity}`
      }
    ];
    if (endpointPolicy) {
      candidates.push({
        type: "endpoint",
        key: `endpoint:${identity}:${method.toUpperCase()}:${path}`,
        rule: endpointPolicy.limit,
        description: `${endpointPolicy.name} endpoint quota for ${identity}`
      });
    }

    const checks = candidates.map((candidate) => ({
      ...candidate,
      result: this.store.inspect(candidate.key, candidate.rule, now)
    }));
    const failed = checks.find((check) => !check.result.allowed);
    if (failed) {
      return {
        allowed: false,
        limitType: failed.type,
        description: failed.description,
        retryAfterSeconds: failed.result.retryAfterSeconds,
        limit: failed.result.limit,
        remaining: 0,
        checks
      };
    }

    // No awaits belong between inspection and commit. This makes the multi-bucket
    // decision atomic within one Node.js event-loop turn and avoids partial charging.
    for (const check of checks) this.store.commit(check.key, check.rule, now);
    return {
      allowed: true,
      limit: Math.min(...checks.map((check) => check.result.limit)),
      remaining: Math.min(...checks.map((check) => check.result.remaining)),
      checks
    };
  }
}
