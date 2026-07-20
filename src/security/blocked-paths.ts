import path from "node:path";
import { minimatch } from "minimatch";
import { getHomeDir, isWindows } from "../utils/platform.js";

/**
 * Default blocked path patterns (glob-style, matched against the
 * normalized absolute path using forward slashes on all platforms).
 * These are checked BEFORE any elicitation request is issued — a
 * blocked path is rejected outright, it is never something the user
 * can approve their way past.
 */
export function getDefaultBlockedPatterns(): string[] {
  const home = getHomeDir().split(path.sep).join("/");
  const patterns = [
    `${home}/.ssh/**`,
    `${home}/.aws/**`,
    `${home}/.gnupg/**`,
    `${home}/.config/google-chrome/**/Login Data`,
    `${home}/.mozilla/firefox/**/logins.json`,
    "/etc/shadow",
  ];

  if (isWindows()) {
    const appData = process.env.APPDATA?.split(path.sep).join("/");
    const localAppData = process.env.LOCALAPPDATA?.split(path.sep).join("/");
    if (appData) patterns.push(`${appData}/Microsoft/Credentials/**`);
    if (localAppData) {
      patterns.push(`${localAppData}/Google/Chrome/User Data/**/Login Data`);
    }
  }

  return patterns;
}

/** Paths that are blocked for WRITE operations only (reads are fine). */
export function getWriteOnlyBlockedPatterns(): string[] {
  return ["/etc/passwd"];
}

export function isBlockedPath(
  absolutePath: string,
  extraPatterns: string[] = [],
  writeOperation = false
): boolean {
  const normalized = absolutePath.split(path.sep).join("/");
  const patterns = [...getDefaultBlockedPatterns(), ...extraPatterns];
  if (writeOperation) {
    patterns.push(...getWriteOnlyBlockedPatterns());
  }

  return patterns.some((pattern) =>
    minimatch(normalized, pattern, { nocase: isWindows() })
  );
}
