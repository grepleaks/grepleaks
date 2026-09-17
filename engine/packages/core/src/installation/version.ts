declare global {
  const OPENCODE_VERSION: string
  const OPENCODE_CHANNEL: string
}

// Bundled builds inline the globals; source and container installs fall back to
// the environment so `grepleaks --version` can report the installed release.
export const InstallationVersion =
  (typeof OPENCODE_VERSION === "string" && OPENCODE_VERSION) ||
  (typeof process !== "undefined" && process.env.OPENCODE_VERSION) ||
  "local"
export const InstallationChannel =
  (typeof OPENCODE_CHANNEL === "string" && OPENCODE_CHANNEL) ||
  (typeof process !== "undefined" && process.env.OPENCODE_CHANNEL) ||
  "local"
export const InstallationLocal = InstallationChannel === "local"
