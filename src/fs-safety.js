"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * Filesystem helpers for paths that are derived from repository content.
 *
 * A lexical `path.resolve()` check is not enough: if a cloned repository holds
 * `assets -> /home/user/.ssh`, then `outputCss: "assets/authorized_keys"` looks
 * like it is inside the project while `writeFileSync` follows the directory
 * symlink and writes outside it. Every writable/deletable path is therefore
 * checked component by component with `lstat`/`realpath` before use, and the
 * final `open`/`unlink` refuses to follow a symlink.
 */

/** `O_NOFOLLOW` is POSIX-only; on Windows the `lstat` guards below still apply. */
const O_NOFOLLOW = fs.constants.O_NOFOLLOW || 0;

/**
 * @param {string} p
 * @returns {string}
 */
function comparable(p) {
  const resolved = path.resolve(p);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/**
 * Like `isInsideRoot`, but `root === target` counts as inside. Used on *real*
 * paths (the root directory itself is the boundary, not an output file).
 * @param {string} root
 * @param {string} target
 * @returns {boolean}
 */
function isInsideOrEqual(root, target) {
  const rel = path.relative(comparable(root), comparable(target));
  if (path.isAbsolute(rel)) return false;
  return rel === "" || (rel !== ".." && !rel.startsWith(".." + path.sep));
}

/**
 * @param {string} absRoot
 * @returns {string}
 */
function realRootOf(absRoot) {
  try {
    return fs.realpathSync.native(absRoot);
  } catch {
    return path.resolve(absRoot);
  }
}

/**
 * Verify that `resolved` does not pass through a symlink that leaves the
 * project root, and that a TailClass-owned file is never itself a symlink.
 *
 * The check walks from the *real* project root. Existing components are
 * `lstat`ed, and every symlink is resolved with `realpath`; a link that lands
 * outside the real root (or cannot be resolved at all) is rejected. Missing
 * components are harmless: they are created as real directories by the caller,
 * which re-runs this check immediately before writing.
 *
 * @param {string} absRoot
 * @param {string} resolved absolute, lexically inside `absRoot`
 * @param {{ key?: string, value?: string, operation?: string }} [options]
 * @returns {string} `resolved`
 */
function assertNoSymlinkEscape(absRoot, resolved, options = {}) {
  const key = options.key || "path";
  const value = options.value || resolved;
  const operation = options.operation || "write";
  const rootReal = realRootOf(absRoot);
  const rel = path.relative(path.resolve(absRoot), path.resolve(resolved));

  if (rel === "" || rel === ".." || rel.startsWith(".." + path.sep) || path.isAbsolute(rel)) {
    const err = new Error(
      `Refusing to ${operation} ${key} "${value}" outside the project root (${absRoot}).`
    );
    err.symlinkEscape = true;
    throw err;
  }

  const parts = rel.split(path.sep).filter(Boolean);
  let cursor = rootReal;

  for (let i = 0; i < parts.length; i += 1) {
    const candidate = path.join(cursor, parts[i]);
    const isLast = i === parts.length - 1;
    let st;
    try {
      st = fs.lstatSync(candidate);
    } catch (err) {
      if (err.code === "ENOENT" || err.code === "ENOTDIR") break;
      throw err;
    }

    if (st.isSymbolicLink()) {
      let linkTarget = null;
      try {
        linkTarget = fs.realpathSync.native(candidate);
      } catch {
        // Broken symlinks are rejected too: their target can appear later.
      }
      if (!linkTarget || !isInsideOrEqual(rootReal, linkTarget)) {
        const err = new Error(
          `Refusing to ${operation} ${key} "${value}" outside the project root (${absRoot}): ` +
            `the path passes through a symlink (symbolic link) at "${candidate}" ` +
            `whose target resolves outside the project root.`
        );
        err.symlinkEscape = true;
        throw err;
      }
      if (isLast) {
        const err = new Error(
          `Refusing to ${operation} ${key} "${value}": the target is a symlink (symbolic link); ` +
            `TailClass output files must be regular files inside the project root.`
        );
        err.symlinkEscape = true;
        throw err;
      }
      // Continue walking from the resolved target so chained links are checked.
      cursor = linkTarget;
    } else {
      if (!isLast && !st.isDirectory()) {
        throw new Error(
          `Refusing to ${operation} ${key} "${value}": "${candidate}" is not a directory.`
        );
      }
      cursor = candidate;
    }
  }

  return resolved;
}

/**
 * Create the parent directory for an output file. The caller re-validates the
 * full path afterwards, so a component swapped for a symlink in the meantime is
 * caught before the file is opened.
 * @param {string} parentDir
 */
function ensureParentDirectory(parentDir) {
  fs.mkdirSync(parentDir, { recursive: true });
}

/**
 * Write `content` to `filePath` without ever following a symlink at the final
 * component. `O_NOFOLLOW` closes the race between the `lstat` check and `open`.
 * @param {string} filePath
 * @param {string} content
 */
function writeFileNoFollow(filePath, content) {
  let st = null;
  try {
    st = fs.lstatSync(filePath);
  } catch (err) {
    if (err.code !== "ENOENT" && err.code !== "ENOTDIR") throw err;
  }
  if (st && st.isSymbolicLink()) {
    throw new Error(
      `Refusing to write through a symlink (symbolic link): ${filePath}. ` +
        `TailClass output files must be regular files.`
    );
  }
  if (st && st.isDirectory()) {
    throw new Error(`Refusing to overwrite a directory: ${filePath}`);
  }

  const flags =
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | O_NOFOLLOW;
  const fd = fs.openSync(filePath, flags, 0o666);
  try {
    fs.writeFileSync(fd, content, "utf8");
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Delete a regular file, never a symlink, directory or special file.
 * @param {string} filePath
 * @param {string} [label]
 * @returns {{ removed: boolean, reason: string | null }}
 */
function unlinkRegularFile(filePath, label = "file") {
  let st;
  try {
    st = fs.lstatSync(filePath);
  } catch (err) {
    if (err.code === "ENOENT" || err.code === "ENOTDIR") {
      return { removed: false, reason: null };
    }
    throw err;
  }
  if (st.isSymbolicLink()) {
    return {
      removed: false,
      reason: `left ${label} ${filePath} untouched: it is a symlink (symbolic link)`,
    };
  }
  if (!st.isFile()) {
    return {
      removed: false,
      reason: `left ${label} ${filePath} untouched: it is not a regular file`,
    };
  }
  fs.unlinkSync(filePath);
  return { removed: true, reason: null };
}

module.exports = {
  isInsideOrEqual,
  assertNoSymlinkEscape,
  ensureParentDirectory,
  writeFileNoFollow,
  unlinkRegularFile,
};
