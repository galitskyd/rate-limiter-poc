import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function assertLimit(limit, label) {
  if (!limit || !Number.isFinite(limit.capacity) || limit.capacity <= 0) {
    throw new Error(`${label}.capacity must be a positive number`);
  }
  if (!Number.isFinite(limit.refillPerSecond) || limit.refillPerSecond <= 0) {
    throw new Error(`${label}.refillPerSecond must be a positive number`);
  }
}

export function validateConfig(config) {
  if (!config || typeof config !== "object") throw new Error("Config must be an object");
  if (!config.tiers?.[config.defaultTier]) throw new Error("defaultTier must name a configured tier");
  for (const [name, limit] of Object.entries(config.tiers ?? {})) assertLimit(limit, `tiers.${name}`);
  for (const [id, client] of Object.entries(config.clients ?? {})) {
    if (!config.tiers[client.tier]) throw new Error(`clients.${id}.tier is not configured`);
    if (client.limit) assertLimit(client.limit, `clients.${id}.limit`);
  }
  for (const [index, policy] of (config.endpointPolicies ?? []).entries()) {
    if (!policy.name || !Array.isArray(policy.methods) || policy.methods.length === 0) {
      throw new Error(`endpointPolicies.${index} requires name and methods`);
    }
    assertLimit(policy.limit, `endpointPolicies.${index}.limit`);
  }
  return config;
}

export function loadConfig(path = process.env.RATE_LIMIT_CONFIG ?? "config/rate-limits.json") {
  const absolutePath = resolve(path);
  const config = JSON.parse(readFileSync(absolutePath, "utf8"));
  return validateConfig(config);
}
