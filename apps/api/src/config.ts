export const appEnvironments = ["development", "preview", "production-sandbox", "production-rialo"] as const;
export type AppEnvironment = (typeof appEnvironments)[number];

function flag(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value == null) return fallback;
  return value.toLowerCase() === "true" || value === "1";
}

function positiveInteger(name: string, fallback: number): number {
  const value = process.env[name];
  if (value == null) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

export function runtimeConfig() {
  const requested = process.env.APP_ENV ?? "development";
  if (!appEnvironments.includes(requested as AppEnvironment)) {
    throw new Error(`Unsupported APP_ENV: ${requested}`);
  }
  const environment = requested as AppEnvironment;
  const rialoPrerequisites = Boolean(process.env.RIALO_NETWORK_URL) && flag("RIALO_TOOLCHAIN_CONFIGURED", false);
  const features = {
    aiComposer: flag("ENABLE_AI_COMPOSER", true),
    replay: flag("ENABLE_REPLAY", true),
    multiStage: flag("ENABLE_MULTI_STAGE", false),
    rialo: flag("ENABLE_RIALO", false) && rialoPrerequisites,
    demoFeed: flag("ENABLE_DEMO_FEED", true),
    advancedConditions: flag("ENABLE_ADVANCED_CONDITIONS", false),
  };
  if (environment === "production-rialo" && !features.rialo) {
    throw new Error("production-rialo requires ENABLE_RIALO, RIALO_NETWORK_URL, and RIALO_TOOLCHAIN_CONFIGURED.");
  }
  if (!features.demoFeed && environment !== "production-rialo") {
    throw new Error(`${environment} requires ENABLE_DEMO_FEED until a qualified execution target exists.`);
  }
  return {
    environment,
    features,
    executionMode: features.rialo && environment === "production-rialo" ? "RIALO" as const : "SANDBOX" as const,
    rialoPrerequisites: { network: Boolean(process.env.RIALO_NETWORK_URL), toolchain: flag("RIALO_TOOLCHAIN_CONFIGURED", false) },
    limits: {
      requestsPerIpPerMinute: positiveInteger("RATE_LIMIT_IP_PER_MINUTE", 300),
      mutationsPerSessionPerMinute: positiveInteger("RATE_LIMIT_SESSION_MUTATIONS_PER_MINUTE", 90),
      anonymousSessionsPerIpPerHour: positiveInteger("RATE_LIMIT_ANONYMOUS_SESSIONS_PER_HOUR", 60),
      sseConnectionsPerSession: positiveInteger("SSE_CONNECTIONS_PER_SESSION", 4),
      sseConnectionsTotal: positiveInteger("SSE_CONNECTIONS_TOTAL", 100),
      triggersPerAccount: positiveInteger("TRIGGERS_PER_ACCOUNT", 100),
    },
  };
}
