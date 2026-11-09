"use strict";

/**
 * Centralised sanitisation helpers.
 *
 * TailClass writes two kinds of attacker-influenced text into files it
 * generates/edits:
 *
 *  1. class names (selectors) and `@apply` utility strings written into the
 *     generated stylesheet, and
 *  2. hand-written source files, where the generated class name is inserted
 *     into markup attributes.
 *
 * Both are derived from *repository content* (markup tokens) or from
 * `tailclass.config.json` / `tailclass.map.json`, which means a cloned
 * repository can influence them. Any character that can terminate a CSS
 * declaration/rule, break out of a CSS comment, or break out of an HTML
 * attribute is therefore rejected here rather than at the call site.
 */

/** Maximum length accepted for a single generated class name. */
const MAX_CLASS_NAME_LENGTH = 128;

/**
 * Characters that must never reach a CSS `@apply` value or selector:
 * `;` and `{`/`}` terminate declarations and rules, and control characters
 * (including newlines) can be used to smuggle extra rules. A literal comment
 * terminator is rejected separately so comments cannot be closed early.
 */
// eslint-disable-next-line no-control-regex
const CSS_UNSAFE_TOKEN_RE = /[;{}\u0000-\u001f\u007f]/;

/**
 * Check whether a raw class token is safe to emit inside `@apply`.
 * @param {string} token
 * @returns {boolean}
 */
function isCssSafeToken(token) {
  if (typeof token !== "string" || token.length === 0) return false;
  if (token.includes("*/")) return false;
  return !CSS_UNSAFE_TOKEN_RE.test(token);
}

/**
 * Check whether a class name can be used verbatim as a CSS selector
 * (`.name`) and as an HTML class attribute value.
 * @param {string} name
 * @returns {boolean}
 */
function isValidClassIdentifier(name) {
  if (typeof name !== "string" || name.length === 0) return false;
  if (name.length > MAX_CLASS_NAME_LENGTH) return false;
  if (!/^[A-Za-z_-][A-Za-z0-9_-]*$/.test(name)) return false;
  // `-3d`/`--3d` style identifiers are invalid CSS class selectors.
  return !/^-?[0-9]/.test(name);
}

/**
 * Strip everything that could terminate a CSS comment, inject a new rule, or
 * forge extra output. Used for labels, categories and element hints that are
 * emitted inside `/* ... *\/` comments.
 * @param {unknown} value
 * @param {number} [maxLength=160]
 * @returns {string}
 */
function sanitizeCommentText(value, maxLength = 160) {
  return String(value ?? "")
    .replace(/[\r\n]+/g, " ")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\*\//g, "*\\/")
    .replace(/\{|\}/g, "")
    .trim()
    .slice(0, maxLength);
}

/**
 * Sanitize a tag/element hint (e.g. `div`, `my-component`) so it is safe to
 * print inside a comment and inside a `<...>` hint.
 * @param {unknown} value
 * @returns {string}
 */
function sanitizeElementName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:-]/g, "")
    .slice(0, 40);
}

/**
 * Sanitize a class-name prefix supplied through configuration so selectors and
 * markup stay valid even if the config is malformed or hostile.
 * @param {unknown} value
 * @returns {string}
 */
function sanitizeClassPrefix(value) {
  return String(value ?? "").replace(/[^A-Za-z0-9_-]/g, "");
}

module.exports = {
  MAX_CLASS_NAME_LENGTH,
  isCssSafeToken,
  isValidClassIdentifier,
  sanitizeCommentText,
  sanitizeElementName,
  sanitizeClassPrefix,
};
