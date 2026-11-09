"use strict";

/**
 * Single source of truth for the TailClass version.
 *
 * `package.json`, the generated stylesheet header, the revert manifest and the
 * dictionary payload all read it from here, and `scripts/lint.js` fails the build
 * when `package.json` and this constant disagree.
 *
 * @type {string}
 */
const VERSION = "1.0.1";

module.exports = { VERSION };
