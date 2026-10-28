export function createRateLimitMiddleware(limiter) {
  return function rateLimitMiddleware(req, res, next) {
    const clientId = req.headers["x-org-id"];
    const url = new URL(req.url, "http://localhost");
    const decision = limiter.check({ clientId, method: req.method, path: url.pathname });

    if (decision.allowed) {
      if (decision.limit != null) {
        res.setHeader("RateLimit-Limit", decision.limit);
        res.setHeader("RateLimit-Remaining", decision.remaining);
      }
      return next();
    }

    res.statusCode = 429;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Retry-After", decision.retryAfterSeconds);
    res.setHeader("RateLimit-Limit", decision.limit);
    res.setHeader("RateLimit-Remaining", 0);
    res.end(JSON.stringify({
      error: "rate_limit_exceeded",
      message: `Request rejected by ${decision.description}`,
      limitType: decision.limitType,
      retryAfterSeconds: decision.retryAfterSeconds
    }));
  };
}
