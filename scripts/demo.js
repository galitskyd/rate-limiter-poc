import { createAppServer } from "../src/server.js";

const server = createAppServer();
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const headers = { "x-org-id": "org-standard-demo" };

console.log("1) Health route is deliberately excluded:");
console.log(await fetch(`${baseUrl}/health`).then(async (response) => ({
  status: response.status,
  body: await response.json()
})));

console.log("\n2) Read route succeeds and exposes quota headers:");
console.log(await fetch(`${baseUrl}/api/widgets`, { headers }).then(async (response) => ({
  status: response.status,
  limit: response.headers.get("ratelimit-limit"),
  remaining: response.headers.get("ratelimit-remaining"),
  body: await response.json()
})));

console.log("\n3) The 21st immediate write is rejected by the stricter write quota:");
let finalResponse;
for (let index = 1; index <= 21; index += 1) {
  finalResponse = await fetch(`${baseUrl}/api/widgets`, { method: "POST", headers });
}
console.log({
  status: finalResponse.status,
  retryAfter: finalResponse.headers.get("retry-after"),
  body: await finalResponse.json()
});

await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
