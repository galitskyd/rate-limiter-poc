import { createServer } from "node:http";
import { loadConfig } from "./config.js";
import { createRateLimitMiddleware } from "./middleware.js";
import { RateLimiter, TokenBucketStore } from "./rate-limiter.js";

function sendJson(res, statusCode, payload) {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

export function createAppServer(config = loadConfig()) {
  const store = new TokenBucketStore();
  const limiter = new RateLimiter(config, { store });
  const rateLimit = createRateLimitMiddleware(limiter);
  const widgets = [{ id: 1, name: "demo widget" }];

  function routes(req, res) {
    const url = new URL(req.url, "http://localhost");
    if (req.method === "GET" && url.pathname === "/health") return sendJson(res, 200, { ok: true });
    if (req.method === "GET" && url.pathname === "/api/widgets") return sendJson(res, 200, { data: widgets });
    if (req.method === "POST" && url.pathname === "/api/widgets") {
      const widget = { id: widgets.length + 1, name: `widget ${widgets.length + 1}` };
      widgets.push(widget);
      return sendJson(res, 201, { data: widget });
    }
    return sendJson(res, 404, { error: "not_found" });
  }

  const server = createServer((req, res) => rateLimit(req, res, () => routes(req, res)));
  const sweepTimer = setInterval(
    () => store.prune(config.idleEntryTtlSeconds * 1000),
    config.sweepIntervalSeconds * 1000
  );
  sweepTimer.unref();
  server.on("close", () => clearInterval(sweepTimer));
  return server;
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replaceAll("\\", "/")}`).href) {
  const port = Number(process.env.PORT ?? 3000);
  createAppServer().listen(port, () => console.log(`Rate limiter demo listening on http://localhost:${port}`));
}
