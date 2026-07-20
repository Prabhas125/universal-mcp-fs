import fs from "node:fs";
import path from "node:path";
import { isBlockedPath } from "./blocked-paths.js";

export class BlockedPathError extends Error {
  constructor(p: string) {
    super(
      `Access to "${p}" is blocked for security reasons (matches a sensitive-path pattern such as .ssh, .aws, or browser credential storage).`
    );
    this.name = "BlockedPathError";
  }
}

export class PathOutsideAllowedDirsError extends Error {
  constructor(p: string, allowedDirs: string[]) {
    super(
      `"${p}" is outside the allowed directories. Allowed: ${allowedDirs.join(", ")}. ` +
        `Start the server with --allowed-dirs to widen access if needed.`
    );
    this.name = "PathOutsideAllowedDirsError";
  }
}

/** Strip null bytes and normalize unicode on raw path input before any fs interaction. */
export function sanitizeInput(input: string): string {
  return input.replace(/\0/g, "").normalize("NFC");
}

/**
 * Validates a user-supplied path:
 *  1. Sanitize input
 *  2. Resolve to an absolute, normalized path (removes .. segments)
 *  3. Reject if it matches the blocked-paths list
 *  4. Resolve symlinks (fs.realpathSync) to prevent symlink escape;
 *     falls back to validating the parent directory for paths that
 *     don't exist yet (e.g. a file about to be created)
 *  5. Confirm the resolved path is inside one of allowedDirs
 *
 * Returns the validated absolute path, or throws BlockedPathError /
 * PathOutsideAllowedDirsError.
 */
export function validatePath(
  userPath: string,
  allowedDirs: string[],
  extraBlockedPatterns: string[] = [],
  writeOperation = false
): string {
  const sanitized = sanitizeInput(userPath);
  const resolved = path.normalize(path.resolve(sanitized));

  if (isBlockedPath(resolved, extraBlockedPatterns, writeOperation)) {
    throw new BlockedPathError(resolved);
  }

  let realPath: string;
  try {
    realPath = fs.realpathSync(resolved);
  } catch {
    // Path doesn't exist yet (e.g. write_file creating a new file) —
    // validate the nearest existing parent directory instead.
    let parent = path.dirname(resolved);
    while (!fs.existsSync(parent) && parent !== path.dirname(parent)) {
      parent = path.dirname(parent);
    }
    try {
      const realParent = fs.realpathSync(parent);
      if (isBlockedPath(realParent, extraBlockedPatterns, writeOperation)) {
        throw new BlockedPathError(realParent);
      }
    } catch (err) {
      if (err instanceof BlockedPathError) throw err;
      // Parent chain unresolvable — fall through to allowed-dir check on `resolved`.
    }
    realPath = resolved;
  }

  const isInsideAllowed = allowedDirs.some((dir) => {
    const realDir = fs.existsSync(dir) ? fs.realpathSync(dir) : path.resolve(dir);
    const relative = path.relative(realDir, realPath);
    return (
      relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))
    );
  });

  if (!isInsideAllowed) {
    throw new PathOutsideAllowedDirsError(realPath, allowedDirs);
  }

  return realPath;
}
