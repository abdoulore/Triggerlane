export const appEnvironments = ["development", "preview", "production-sandbox", "production-rialo"] as const;
export type AppEnvironment = (typeof appEnvironments)[number];

function flag(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value == null) return fallback;
  return value.toLowerCase() === "true" || value === "1";
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
  };
}
