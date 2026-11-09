"use strict";

const { isCssSafeToken } = require("./css-safety");

/**
 * Exact single-token Tailwind CSS v3 & v4 utilities.
 * Mapped to [bucket, propertyGroup].
 */
const EXACT_UTILITIES = new Map([
  // Display & Box
  ["block", [1, "display"]],
  ["inline-block", [1, "display"]],
  ["inline", [1, "display"]],
  ["flex", [1, "display"]],
  ["inline-flex", [1, "display"]],
  ["grid", [1, "display"]],
  ["inline-grid", [1, "display"]],
  ["table", [1, "display"]],
  ["inline-table", [1, "display"]],
  ["table-caption", [1, "display"]],
  ["table-cell", [1, "display"]],
  ["table-column", [1, "display"]],
  ["table-column-group", [1, "display"]],
  ["table-footer-group", [1, "display"]],
  ["table-header-group", [1, "display"]],
  ["table-row-group", [1, "display"]],
  ["table-row", [1, "display"]],
  ["flow-root", [1, "display"]],
  ["contents", [1, "display"]],
  ["list-item", [1, "display"]],
  ["hidden", [1, "display"]],
  ["sr-only", [1, "a11y"]],
  ["not-sr-only", [1, "a11y"]],
  ["container", [0, "container"]],
  ["@container", [0, "container"]],

  // Position & Visibility
  ["static", [2, "position"]],
  ["fixed", [2, "position"]],
  ["absolute", [2, "position"]],
  ["relative", [2, "position"]],
  ["sticky", [2, "position"]],
  ["visible", [2, "visibility"]],
  ["invisible", [2, "visibility"]],
  ["collapse", [2, "visibility"]],
  ["isolate", [2, "isolation"]],

  // Flex / Grid singletons
  ["grow", [3, "flex-grow"]],
  ["shrink", [3, "flex-shrink"]],

  // Typography singletons
  ["antialiased", [6, "font-smoothing"]],
  ["subpixel-antialiased", [6, "font-smoothing"]],
  ["italic", [6, "font-style"]],
  ["not-italic", [6, "font-style"]],
  ["normal-nums", [6, "font-variant-numeric"]],
  ["ordinal", [6, "font-variant-numeric"]],
  ["slashed-zero", [6, "font-variant-numeric"]],
  ["lining-nums", [6, "font-variant-numeric"]],
  ["oldstyle-nums", [6, "font-variant-numeric"]],
  ["proportional-nums", [6, "font-variant-numeric"]],
  ["tabular-nums", [6, "font-variant-numeric"]],
  ["diagonal-fractions", [6, "font-variant-numeric"]],
  ["stacked-fractions", [6, "font-variant-numeric"]],
  ["underline", [6, "text-decoration"]],
  ["overline", [6, "text-decoration"]],
  ["line-through", [6, "text-decoration"]],
  ["no-underline", [6, "text-decoration"]],
  ["uppercase", [6, "text-transform"]],
  ["lowercase", [6, "text-transform"]],
  ["capitalize", [6, "text-transform"]],
  ["normal-case", [6, "text-transform"]],
  ["truncate", [6, "text-overflow"]],
  ["prose", [6, "prose"]],
  ["not-prose", [6, "prose"]],
  ["wrap-break-word", [6, "word-break"]],
  ["wrap-anywhere", [6, "word-break"]],
  ["wrap-normal", [6, "word-break"]],

  // Borders, Rings, Shadows, Filters, Transitions singletons
  ["rounded", [8, "rounded"]],
  ["border", [8, "border-width"]],
  ["outline", [8, "outline-style"]],
  ["ring", [8, "ring-width"]],
  ["inset-ring", [8, "inset-ring-width"]],
  ["shadow", [9, "shadow"]],
  ["inset-shadow", [9, "inset-shadow"]],
  ["blur", [9, "blur"]],
  ["drop-shadow", [9, "drop-shadow"]],
  ["grayscale", [9, "grayscale"]],
  ["invert", [9, "invert"]],
  ["sepia", [9, "sepia"]],
  ["backdrop-blur", [9, "backdrop-blur"]],
  ["backdrop-grayscale", [9, "backdrop-grayscale"]],
  ["backdrop-invert", [9, "backdrop-invert"]],
  ["backdrop-sepia", [9, "backdrop-sepia"]],
  ["transition", [10, "transition"]],
  ["transform", [10, "transform"]],
  ["transform-gpu", [10, "transform"]],
  ["transform-cpu", [10, "transform"]],
  ["transform-none", [10, "transform"]],
  ["resize", [11, "resize"]],
]);

/**
 * Marker classes recognized by Tailwind that CANNOT be placed inside `@apply`
 * because they act as parent/sibling/container selector hooks (`group-hover:`,
 * `peer-focus:`, `@md/sidebar:`). TailClass automatically keeps these inline!
 */
const NON_APPLYABLE_MARKERS =
  /^((?:group|peer)(?:\/[a-zA-Z0-9_-]+)?|@container\/[a-zA-Z0-9_-]+|dark)$/;

/**
 * Ordered prefix rules: [regex, bucket, propertyGroupFnOrString]
 * Buckets keep canonical class ordering clean and predictable:
 *  0: container / columns / aspect / box
 *  1: display / overflow / float / object
 *  2: position / inset / z-index
 *  3: flex / grid / alignment / gap
 *  4: width / height / size
 *  5: padding / margin / space
 *  6: typography
 *  7: backgrounds / gradients
 *  8: borders / rounded / divide / ring / outline
 *  9: effects / shadow / opacity / filters / backdrop
 * 10: transitions / duration / ease / animate / transforms
 * 11: interactivity / cursor / select / scroll / svg
 */
const PREFIX_RULES = [
  // 0 & 1: Layout, Box, Overflow
  [/^@container(?:\/[a-zA-Z0-9_-]+)?$/, 0, "container"],
  [/^aspect-(?:auto|square|video|\[.+\]|[0-9]+\/[0-9]+)$/, 0, "aspect"],
  [/^columns-(?:[0-9]+|auto|[0-9]*xs|[0-9]*sm|md|lg|[0-9]*xl|\[.+\])$/, 0, "columns"],
  [/^break-(?:after|before|inside)-[a-z-]+$/, 1, "break"],
  [/^box-(?:border|content|decoration-(?:clone|slice))$/, 0, "box"],
  [/^float-(?:start|end|right|left|none)$/, 1, "float"],
  [/^clear-(?:start|end|right|left|both|none)$/, 1, "clear"],
  [/^isolation-(?:isolate|auto)$/, 2, "isolation"],
  [/^object-(?:contain|cover|fill|none|scale-down|bottom|center|left|left-bottom|left-top|right|right-bottom|right-top|top|\[.+\])$/, 1, "object"],
  [/^overflow-(?:auto|hidden|clip|visible|scroll|[xy]-(?:auto|hidden|clip|visible|scroll))$/, 1, (b) =>
    b.startsWith("overflow-x-") ? "overflow-x" : b.startsWith("overflow-y-") ? "overflow-y" : "overflow"
  ],
  [/^overscroll-(?:auto|contain|none|[xy]-(?:auto|contain|none))$/, 1, (b) =>
    b.startsWith("overscroll-x-") ? "overscroll-x" : b.startsWith("overscroll-y-") ? "overscroll-y" : "overscroll"
  ],

  // 2: Positioning & Z-index
  [/^(?:inset|inset-x|inset-y|top|right|bottom|left|start|end)-(?:[0-9.]+|px|auto|full|[0-9]+\/[0-9]+|\[.+\])$/, 2, (b) =>
    b.startsWith("inset-x-") ? "inset-x" : b.startsWith("inset-y-") ? "inset-y" : b.split("-")[0]
  ],
  [/^z-(?:[0-9]+|auto|\[.+\])$/, 2, "z"],

  // 3: Flexbox & Grid
  [/^basis-(?:[0-9.]+|px|auto|full|[0-9]+\/[0-9]+|[0-9]*xs|[0-9]*sm|md|lg|[0-9]*xl|\[.+\])$/, 3, "basis"],
  [/^flex-(?:row|row-reverse|col|col-reverse|wrap|wrap-reverse|nowrap|1|auto|initial|none|\[.+\])$/, 3, "flex"],
  [/^grow-(?:0|[0-9]+|\[.+\])$/, 3, "flex-grow"],
  [/^shrink-(?:0|[0-9]+|\[.+\])$/, 3, "flex-shrink"],
  [/^order-(?:[0-9]+|first|last|none|\[.+\])$/, 3, "order"],
  [/^grid-cols-(?:[0-9]+|none|subgrid|\[.+\])$/, 3, "grid-cols"],
  [/^col-(?:auto|span-(?:[0-9]+|full|\[.+\])|start-(?:[0-9]+|auto|\[.+\])|end-(?:[0-9]+|auto|\[.+\]))$/, 3, "col"],
  [/^grid-rows-(?:[0-9]+|none|subgrid|\[.+\])$/, 3, "grid-rows"],
  [/^row-(?:auto|span-(?:[0-9]+|full|\[.+\])|start-(?:[0-9]+|auto|\[.+\])|end-(?:[0-9]+|auto|\[.+\]))$/, 3, "row"],
  [/^grid-flow-(?:row|col|dense|row-dense|col-dense)$/, 3, "grid-flow"],
  [/^auto-cols-(?:auto|min|max|fr|\[.+\])$/, 3, "auto-cols"],
  [/^auto-rows-(?:auto|min|max|fr|\[.+\])$/, 3, "auto-rows"],
  [/^gap-(?:(?:x-|y-)?(?:[0-9.]+|px|\[.+\]))$/, 3, (b) => (b.startsWith("gap-x-") ? "gap-x" : b.startsWith("gap-y-") ? "gap-y" : "gap")],
  [/^justify-(?:normal|start|end|center|between|around|evenly|stretch|baseline|items-[a-z]+|self-[a-z]+)$/, 3, "justify"],
  [/^content-(?:normal|center|start|end|between|around|evenly|baseline|stretch|none|\[.+\])$/, 3, "content"],
  [/^items-(?:start|end|center|baseline|stretch)$/, 3, "items"],
  [/^self-(?:auto|start|end|center|stretch|baseline)$/, 3, "self"],
  [/^place-(?:content|items|self)-[a-z-]+$/, 3, "place"],

  // 4: Sizing
  [/^(?:w|min-w|max-w|h|min-h|max-h|size)-(?:[0-9.]+|px|auto|full|screen|svw|lvw|dvw|svh|lvh|dvh|min|max|fit|prose|[0-9]+\/[0-9]+|[0-9]*xs|[0-9]*sm|md|lg|[0-9]*xl|screen-(?:sm|md|lg|xl|2xl)|none|\[.+\])$/, 4, (b) => {
    const m = b.match(/^(min-w|max-w|min-h|max-h|w|h|size)-/);
    return m ? m[1] : "size";
  }],

  // 5: Spacing (Padding, Margin, Space Between)
  [/^(?:p|px|py|pt|pr|pb|pl|ps|pe)-(?:[0-9.]+|px|\[.+\])$/, 5, (b) => b.split("-")[0]],
  [/^(?:m|mx|my|mt|mr|mb|ml|ms|me)-(?:[0-9.]+|px|auto|\[.+\])$/, 5, (b) => b.split("-")[0]],
  [/^space-[xy]-(?:[0-9.]+|px|reverse|\[.+\])$/, 5, (b) => b.slice(0, 7)],

  // 6: Typography
  [/^font-(?:sans|serif|mono|thin|extralight|light|normal|medium|semibold|bold|extrabold|black|stretch-[a-z0-9%-]+|\[.+\])$/, 6, (b) =>
    /^font-(?:thin|extralight|light|normal|medium|semibold|bold|extrabold|black|\[\d+\])$/.test(b)
      ? "font-weight"
      : "font-family"
  ],
  [/^text-(?:xs|sm|base|lg|xl|[2-9]xl)(?:\/[a-z0-9.[\]%]+)?$/, 6, "text-size"],
  [/^text-(?:left|center|right|justify|start|end)$/, 6, "text-align"],
  [/^text-(?:wrap|nowrap|balance|pretty)$/, 6, "text-wrap"],
  [/^text-(?:ellipsis|clip)$/, 6, "text-overflow"],
  [/^text-(?:inherit|current|transparent|black|white|[a-z]+-(?:50|[1-9]00|950)|\[.+\])(?:\/[0-9.[\]%]+)?$/, 6, "text-color"],
  [/^leading-(?:[0-9.]+|none|tight|snug|normal|relaxed|loose|\[.+\])$/, 6, "leading"],
  [/^tracking-(?:tighter|tight|normal|wide|wider|widest|\[.+\])$/, 6, "tracking"],
  [/^line-clamp-(?:[0-9]+|none|\[.+\])$/, 6, "line-clamp"],
  [/^list-(?:inside|outside|none|disc|decimal|image-\[.+\]|\[.+\])$/, 6, "list"],
  [/^decoration-(?:solid|double|dotted|dashed|wavy|auto|from-font|[0-9]+|inherit|current|transparent|black|white|[a-z]+-(?:50|[1-9]00|950)|\[.+\])(?:\/[0-9.[\]%]+)?$/, 6, "decoration"],
  [/^underline-offset-(?:auto|[0-9]+|\[.+\])$/, 6, "underline-offset"],
  [/^indent-(?:[0-9.]+|px|\[.+\])$/, 6, "indent"],
  [/^align-(?:baseline|top|middle|bottom|text-top|text-bottom|sub|super|\[.+\])$/, 6, "align"],
  [/^whitespace-(?:normal|nowrap|pre|pre-line|pre-wrap|break-spaces)$/, 6, "whitespace"],
  [/^break-(?:normal|words|all|keep)$/, 6, "word-break"],
  [/^hyphens-(?:none|manual|auto)$/, 6, "hyphens"],
  [/^prose-(?:sm|base|lg|xl|2xl|invert|[a-z]+)$/, 6, "prose"],

  // 7: Backgrounds & Gradients
  [/^bg-(?:fixed|local|scroll|auto|cover|contain|bottom|center|left|left-bottom|left-top|right|right-bottom|right-top|top|repeat|no-repeat|repeat-x|repeat-y|repeat-round|repeat-space|none)$/, 7, "bg-prop"],
  [/^bg-clip-(?:border|padding|content|text)$/, 7, "bg-clip"],
  [/^bg-origin-(?:border|padding|content)$/, 7, "bg-origin"],
  [/^bg-(?:gradient-to-(?:t|tr|r|br|b|bl|l|tl)|linear-(?:to-[a-z]+|[0-9]+deg|\[.+\])|radial(?:-\[.+\])?|conic(?:-\[.+\])?)$/, 7, "bg-gradient"],
  [/^bg-(?:inherit|current|transparent|black|white|[a-z]+-(?:50|[1-9]00|950)|\[.+\])(?:\/[0-9.[\]%]+)?$/, 7, "bg-color"],
  [/^(?:from|via|to)-(?:inherit|current|transparent|black|white|[a-z]+-(?:50|[1-9]00|950)|[0-9]+%|\[.+\])(?:\/[0-9.[\]%]+)?$/, 7, (b) => b.split("-")[0]],

  // 8: Borders, Rounded, Divide, Outline, Ring
  [/^rounded(?:-(?:t|r|b|l|tl|tr|br|bl|s|e|ss|se|ee|es))?(?:-(?:none|xs|sm|md|lg|xl|2xl|3xl|4xl|full|\[.+\]))?$/, 8, (b) => {
    const m = b.match(/^rounded-(tl|tr|br|bl|ss|se|ee|es|t|r|b|l|s|e)(?:-|$)/);
    return m ? `rounded-${m[1]}` : "rounded";
  }],
  [/^border(?:-(?:x|y|s|e|t|r|b|l))?(?:-(?:0|2|4|8|\[.+\]))?$/, 8, (b) => {
    const m = b.match(/^border-(x|y|s|e|t|r|b|l)(?:-|$)/);
    return m ? `border-width-${m[1]}` : "border-width";
  }],
  [/^border-(?:solid|dashed|dotted|double|hidden|none|collapse|separate)$/, 8, "border-style"],
  [/^border-spacing-(?:(?:x-|y-)?(?:[0-9.]+|px|\[.+\]))$/, 8, "border-spacing"],
  [/^border(?:-(?:x|y|s|e|t|r|b|l))?-(?:inherit|current|transparent|black|white|[a-z]+-(?:50|[1-9]00|950)|\[.+\])(?:\/[0-9.[\]%]+)?$/, 8, (b) => {
    const m = b.match(/^border-(x|y|s|e|t|r|b|l)-/);
    return m ? `border-color-${m[1]}` : "border-color";
  }],
  [/^divide-(?:[xy](?:-(?:0|2|4|8|reverse|\[.+\]))?|solid|dashed|dotted|double|none|(?:inherit|current|transparent|black|white|[a-z]+-(?:50|[1-9]00|950)|\[.+\])(?:\/[0-9.[\]%]+)?)$/, 8, "divide"],
  [/^outline-(?:none|dashed|dotted|double|hidden|[0-9]+|offset-(?:[0-9]+|\[.+\])|(?:inherit|current|transparent|black|white|[a-z]+-(?:50|[1-9]00|950)|\[.+\])(?:\/[0-9.[\]%]+)?)$/, 8, "outline"],
  [/^(?:inset-)?ring-(?:0|1|2|4|8|inset|offset-(?:[0-9]+|inherit|current|transparent|black|white|[a-z]+-(?:50|[1-9]00|950)|\[.+\])|(?:inherit|current|transparent|black|white|[a-z]+-(?:50|[1-9]00|950)|\[.+\])(?:\/[0-9.[\]%]+)?)$/, 8, (b) => {
    const clean = b.replace(/^inset-/, "");
    if (/^ring-(?:0|1|2|4|8)$/.test(clean)) return b.startsWith("inset-") ? "inset-ring-width" : "ring-width";
    if (clean === "ring-inset") return "ring-inset";
    if (clean.startsWith("ring-offset-")) {
      return /^ring-offset-[0-9]+$/.test(clean) ? "ring-offset-width" : "ring-offset-color";
    }
    return b.startsWith("inset-") ? "inset-ring-color" : "ring-color";
  }],

  // 9: Effects, Shadows, Filters, Backdrop
  [/^(?:inset-)?shadow-(?:2xs|xs|sm|md|lg|xl|2xl|inner|none|(?:inherit|current|transparent|black|white|[a-z]+-(?:50|[1-9]00|950)|\[.+\])(?:\/[0-9.[\]%]+)?)$/, 9, "shadow"],
  [/^opacity-(?:[0-9]+|\[.+\])$/, 9, "opacity"],
  [/^(?:mix|bg)-blend-[a-z-]+$/, 9, "blend"],
  [/^(?:backdrop-)?blur-(?:none|xs|sm|md|lg|xl|2xl|3xl|\[.+\])$/, 9, "blur"],
  [/^(?:backdrop-)?(?:brightness|contrast|hue-rotate|saturate)-(?:[0-9]+|\[.+\])$/, 9, "filter"],
  [/^(?:backdrop-)?(?:grayscale|invert|sepia)-(?:0|\[.+\])$/, 9, "filter"],
  [/^backdrop-opacity-(?:[0-9]+|\[.+\])$/, 9, "backdrop-opacity"],
  [/^drop-shadow-(?:xs|sm|md|lg|xl|2xl|none|\[.+\])$/, 9, "drop-shadow"],

  // 10: Transitions, Animations & Transforms
  [/^transition-(?:none|all|colors|opacity|shadow|transform|discrete|\[.+\])$/, 10, "transition"],
  [/^(?:duration|delay)-(?:[0-9]+|initial|\[.+\])$/, 10, (b) => b.split("-")[0]],
  [/^ease-(?:linear|in|out|in-out|initial|\[.+\])$/, 10, "ease"],
  [/^animate-(?:none|spin|ping|pulse|bounce|[a-z0-9_-]+|\[.+\])$/, 10, "animate"],
  [/^scale-(?:(?:x-|y-|z-)?(?:[0-9]+|3d|\[.+\]))$/, 10, "scale"],
  [/^rotate-(?:(?:x-|y-|z-)?(?:[0-9]+|\[.+\]))$/, 10, "rotate"],
  [/^translate-(?:[xyz]-(?:[0-9.]+|px|full|[0-9]+\/[0-9]+|\[.+\])|3d|none)$/, 10, "translate"],
  [/^skew-[xy]-(?:[0-9]+|\[.+\])$/, 10, "skew"],
  [/^origin-(?:center|top|top-right|right|bottom-right|bottom|bottom-left|left|top-left|\[.+\])$/, 10, "origin"],
  [/^perspective-(?:dramatic|near|normal|midrange|distant|none|\[.+\])$/, 10, "perspective"],
  [/^backface-(?:visible|hidden)$/, 10, "backface"],

  // 11: Interactivity, Scroll, SVG, Tables
  [/^accent-(?:auto|inherit|current|transparent|black|white|[a-z]+-(?:50|[1-9]00|950)|\[.+\])(?:\/[0-9.[\]%]+)?$/, 11, "accent"],
  [/^appearance-(?:none|auto)$/, 11, "appearance"],
  [/^cursor-(?:auto|default|pointer|wait|text|move|help|not-allowed|none|context-menu|progress|cell|crosshair|vertical-text|alias|copy|no-drop|grab|grabbing|all-scroll|col-resize|row-resize|n-resize|e-resize|s-resize|w-resize|ne-resize|nw-resize|se-resize|sw-resize|ew-resize|ns-resize|nesw-resize|nwse-resize|zoom-in|zoom-out|\[.+\])$/, 11, "cursor"],
  [/^caret-(?:inherit|current|transparent|black|white|[a-z]+-(?:50|[1-9]00|950)|\[.+\])(?:\/[0-9.[\]%]+)?$/, 11, "caret"],
  [/^pointer-events-(?:none|auto)$/, 11, "pointer-events"],
  [/^resize-(?:none|y|x)$/, 11, "resize"],
  [/^scroll-(?:auto|smooth|(?:m|mx|my|mt|mr|mb|ml|ms|me|p|px|py|pt|pr|pb|pl|ps|pe)-(?:[0-9.]+|px|\[.+\]))$/, 11, "scroll"],
  [/^snap-(?:none|x|y|both|mandatory|proximity|start|end|center|align-none|normal|always)$/, 11, "snap"],
  [/^touch-(?:auto|none|pan-x|pan-left|pan-right|pan-y|pan-up|pan-down|pinch-zoom|manipulation)$/, 11, "touch"],
  [/^select-(?:none|text|all|auto)$/, 11, "select"],
  [/^will-change-(?:auto|scroll|contents|transform|\[.+\])$/, 11, "will-change"],
  [/^(?:fill|stroke)-(?:none|inherit|current|transparent|black|white|[a-z]+-(?:50|[1-9]00|950)|[0-9.]+|\[.+\])(?:\/[0-9.[\]%]+)?$/, 11, (b) => b.split("-")[0]],
  [/^table-(?:auto|fixed)$/, 11, "table-layout"],
  [/^caption-(?:top|bottom)$/, 11, "caption-side"],
  [/^field-sizing-(?:content|fixed)$/, 11, "field-sizing"],
  [/^scheme-(?:normal|dark|light|light-dark|only-dark|only-light)$/, 11, "color-scheme"],
];

/**
 * Valid Tailwind variant prefix pattern (responsive, state, dark, group/peer,
 * container queries, aria/data/supports/has, arbitrary variants).
 */
const VALID_VARIANT_RE =
  /^(?:sm|md|lg|xl|2xl|max-(?:sm|md|lg|xl|2xl|\[.+\])|min-\[.+\]|@[a-z0-9_-]+(?:\/[a-zA-Z0-9_-]+)?|hover|focus|focus-within|focus-visible|active|visited|target|first|last|only|odd|even|first-of-type|last-of-type|only-of-type|empty|disabled|enabled|checked|indeterminate|default|optional|required|valid|invalid|user-valid|user-invalid|in-range|out-of-range|placeholder-shown|autofill|read-only|open|closed|before|after|first-letter|first-line|marker|selection|file|backdrop|placeholder|details-content|dark|light|print|portrait|landscape|motion-safe|motion-reduce|contrast-more|contrast-less|forced-colors|inverted-colors|noscript|pointer-fine|pointer-coarse|any-pointer-fine|any-pointer-coarse|ltr|rtl|starting|inert|(?:group|peer|has|in|not)-(?:[a-z0-9-]+|\[.+\])(?:\/[a-zA-Z0-9_-]+)?|(?:aria|data|supports|nth|nth-last|nth-of-type|nth-last-of-type)-(?:[a-z0-9-]+|\[.+\])|\*|\*\*|\[.+\])$/;

/**
 * Canonical ordering priority for variants so `sm:` comes before `md:`, `lg:`,
 * `dark:`, `hover:`, `focus:`, `active:`, `disabled:`.
 */
const VARIANT_ORDER = new Map([
  ["sm", 10],
  ["md", 11],
  ["lg", 12],
  ["xl", 13],
  ["2xl", 14],
  ["dark", 20],
  ["hover", 30],
  ["focus", 31],
  ["focus-visible", 32],
  ["focus-within", 33],
  ["active", 34],
  ["disabled", 35],
]);

/**
 * Split a raw class attribute string into whitespace-delimited tokens while
 * respecting square-bracketed arbitrary expressions.
 * @param {string} classString
 * @returns {string[]}
 */
function splitClassTokens(classString) {
  if (!classString || typeof classString !== "string") return [];
  const tokens = [];
  let current = "";
  let bracketDepth = 0;

  for (let i = 0; i < classString.length; i++) {
    const ch = classString[i];
    if (ch === "[") {
      bracketDepth++;
      current += ch;
    } else if (ch === "]") {
      if (bracketDepth > 0) bracketDepth--;
      current += ch;
    } else if (/\s/.test(ch) && bracketDepth === 0) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

/**
 * Split a token on top-level `:` colons (ignoring colons inside `[...]`).
 * @param {string} token
 * @returns {string[]}
 */
function splitTopLevelColons(token) {
  const parts = [];
  let current = "";
  let bracketDepth = 0;

  for (let i = 0; i < token.length; i++) {
    const ch = token[i];
    if (ch === "[") {
      bracketDepth++;
      current += ch;
    } else if (ch === "]") {
      if (bracketDepth > 0) bracketDepth--;
      current += ch;
    } else if (ch === ":" && bracketDepth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

/**
 * Classify a single class token and return rich metadata.
 * @param {string} rawToken
 * @param {{ tailwindPrefix?: string }} [options]
 */
function classifyToken(rawToken, options = {}) {
  const token = String(rawToken || "").trim();
  if (!token) {
    return {
      raw: "",
      variants: [],
      base: "",
      important: false,
      negative: false,
      isTailwind: false,
      isApplyable: false,
      isMarker: false,
      bucket: 99,
      propertyGroup: "custom",
      sortKey: "99|",
    };
  }

  // Class tokens are ultimately written into `@apply` rules inside the generated
  // stylesheet. Tokens carrying `;`, `{`, `}`, control characters or `*/` could
  // terminate the declaration/rule (or the surrounding comment) and inject
  // arbitrary CSS, so they are never treated as applyable Tailwind utilities.
  // They are kept inline in the markup (and thus still work) instead.
  if (!isCssSafeToken(token)) {
    return {
      raw: token,
      variants: [],
      base: token,
      important: false,
      negative: false,
      isTailwind: false,
      isApplyable: false,
      isMarker: false,
      bucket: 99,
      propertyGroup: "custom",
      sortKey: `99|${token}`,
    };
  }

  const parts = splitTopLevelColons(token);
  const rawUtility = parts[parts.length - 1];
  const variants = parts.slice(0, -1);

  for (const v of variants) {
    if (!VALID_VARIANT_RE.test(v)) {
      return {
        raw: token,
        variants,
        base: rawUtility,
        important: false,
        negative: false,
        isTailwind: false,
        isApplyable: false,
        isMarker: false,
        bucket: 99,
        propertyGroup: "custom",
        sortKey: `99|${token}`,
      };
    }
  }

  let base = rawUtility;
  let important = false;

  if (base.startsWith("!")) {
    important = true;
    base = base.slice(1);
  } else if (base.endsWith("!") && !base.endsWith("]!")) {
    important = true;
    base = base.slice(0, -1);
  } else if (base.endsWith("]!")) {
    important = true;
    base = base.slice(0, -1);
  }

  const twPrefix = options.tailwindPrefix || "";
  if (twPrefix) {
    if (base.startsWith(twPrefix)) {
      base = base.slice(twPrefix.length);
    } else if (base.startsWith("-" + twPrefix)) {
      base = "-" + base.slice(1 + twPrefix.length);
    } else {
      return {
        raw: token,
        variants,
        base,
        important,
        negative: false,
        isTailwind: false,
        isApplyable: false,
        isMarker: false,
        bucket: 99,
        propertyGroup: "custom",
        sortKey: `99|${token}`,
      };
    }
  }

  // Marker classes (`group`, `peer`, `dark`) are valid Tailwind tokens,
  // yet must remain inline on elements rather than being placed in `@apply`.
  if (variants.length === 0 && NON_APPLYABLE_MARKERS.test(base)) {
    return {
      raw: token,
      variants,
      base,
      important,
      negative: false,
      isTailwind: true,
      isApplyable: false,
      isMarker: true,
      bucket: 0,
      propertyGroup: "marker",
      sortKey: `00|${token}`,
    };
  }

  // Arbitrary CSS property utility: e.g. `[mask-type:luminance]`
  if (base.startsWith("[") && base.endsWith("]") && base.includes(":")) {
    const propName = base.slice(1, base.indexOf(":")).trim();
    const variantSort = computeVariantSortKey(variants);
    return {
      raw: token,
      variants,
      base,
      important,
      negative: false,
      isTailwind: true,
      isApplyable: true,
      isMarker: false,
      bucket: 12,
      propertyGroup: `arb:${propName}`,
      sortKey: `${variantSort}|12|${base}|${token}`,
    };
  }

  let negative = false;
  let lookupBase = base;
  if (lookupBase.startsWith("-") && lookupBase.length > 1 && !lookupBase.startsWith("--")) {
    negative = true;
    lookupBase = lookupBase.slice(1);
  }

  if (!negative && EXACT_UTILITIES.has(lookupBase)) {
    const [bucket, propGroup] = EXACT_UTILITIES.get(lookupBase);
    const subPrio = computeSubPriority(propGroup);
    const variantSort = computeVariantSortKey(variants);
    const scopedGroup = variants.length ? `${variants.join(":")}:${propGroup}` : propGroup;
    return {
      raw: token,
      variants,
      base: lookupBase,
      important,
      negative: false,
      isTailwind: true,
      isApplyable: true,
      isMarker: false,
      bucket,
      propertyGroup: scopedGroup,
      cssAxes: expandCssAxes(scopedGroup),
      sortKey: `${variantSort}|${String(bucket).padStart(2, "0")}.${subPrio}|${lookupBase}|${token}`,
    };
  }

  for (const [regex, bucket, groupResolver] of PREFIX_RULES) {
    if (regex.test(lookupBase)) {
      const baseGroup =
        typeof groupResolver === "function" ? groupResolver(lookupBase) : groupResolver;
      const subPrio = computeSubPriority(baseGroup);
      const scopedGroup = variants.length ? `${variants.join(":")}:${baseGroup}` : baseGroup;
      const variantSort = computeVariantSortKey(variants);
      return {
        raw: token,
        variants,
        base: lookupBase,
        important,
        negative,
        isTailwind: true,
        isApplyable: true,
        isMarker: false,
        bucket,
        propertyGroup: scopedGroup,
        cssAxes: expandCssAxes(scopedGroup),
        sortKey: `${variantSort}|${String(bucket).padStart(2, "0")}.${subPrio}|${negative ? "-" : ""}${lookupBase}|${token}`,
      };
    }
  }

  return {
    raw: token,
    variants,
    base,
    important,
    negative,
    isTailwind: false,
    isApplyable: false,
    isMarker: false,
    bucket: 99,
    propertyGroup: "custom",
    sortKey: `99|${token}`,
  };
}

/**
 * Compute a deterministic sort key segment for variant stacks.
 * Base utilities (no variants) always sort before variant-prefixed utilities.
 * @param {string[]} variants
 * @returns {string}
 */
function computeVariantSortKey(variants) {
  if (!variants || variants.length === 0) return "0|00";
  const scores = variants.map((v) => {
    const known = VARIANT_ORDER.get(v);
    return known !== undefined ? `${String(known).padStart(2, "0")}:${v}` : `50:${v}`;
  });
  return `${variants.length}|${scores.join("+")}`;
}

/**
 * Sub-priority (0..9) inside a bucket ensuring CSS shorthands ALWAYS emit
 * before axis shorthands, which ALWAYS emit before single-side/corner longhands,
 * and `text-<size>` emits before `leading-*` so line-height overrides win!
 * @param {string} baseGroup
 * @returns {number}
 */
function computeSubPriority(baseGroup) {
  switch (baseGroup) {
    // Positioning
    case "position":
      return 1;
    case "inset":
      return 2;
    case "inset-x":
    case "inset-y":
      return 3;
    case "top":
    case "right":
    case "bottom":
    case "left":
    case "start":
    case "end":
      return 4;
    case "z":
      return 5;

    // Overflow & Overscroll
    case "overflow":
    case "overscroll":
      return 4;
    case "overflow-x":
    case "overflow-y":
    case "overscroll-x":
    case "overscroll-y":
      return 5;

    // Gap
    case "gap":
      return 7;
    case "gap-x":
    case "gap-y":
      return 8;

    // Sizing
    case "size":
      return 1;
    case "w":
    case "h":
      return 2;
    case "min-w":
    case "max-w":
    case "min-h":
    case "max-h":
      return 3;

    // Spacing: p -> px/py -> pt/pr/pb/pl, m -> mx/my -> mt/mr/mb/ml
    case "p":
      return 1;
    case "px":
    case "py":
      return 2;
    case "pt":
    case "pr":
    case "pb":
    case "pl":
    case "ps":
    case "pe":
      return 3;
    case "m":
      return 4;
    case "mx":
    case "my":
      return 5;
    case "mt":
    case "mr":
    case "mb":
    case "ml":
    case "ms":
    case "me":
      return 6;
    case "space-x":
    case "space-y":
      return 7;

    // Typography: font-size (`text-lg`) BEFORE `leading-*` so custom line-height is never clobbered
    case "font-family":
    case "font-weight":
    case "font-style":
      return 1;
    case "text-size":
      return 2;
    case "leading":
      return 3;
    case "tracking":
      return 4;
    case "text-align":
      return 5;
    case "text-color":
      return 6;

    // Borders & Rounded: all-sides -> axis -> single-side/corner
    case "rounded":
      return 1;
    case "rounded-t":
    case "rounded-r":
    case "rounded-b":
    case "rounded-l":
    case "rounded-s":
    case "rounded-e":
      return 2;
    case "rounded-tl":
    case "rounded-tr":
    case "rounded-br":
    case "rounded-bl":
    case "rounded-ss":
    case "rounded-se":
    case "rounded-ee":
    case "rounded-es":
      return 3;
    case "border-width":
      return 4;
    case "border-width-x":
    case "border-width-y":
    case "border-width-s":
    case "border-width-e":
      return 5;
    case "border-width-t":
    case "border-width-r":
    case "border-width-b":
    case "border-width-l":
      return 6;
    case "border-style":
      return 7;
    case "border-color":
      return 8;
    case "border-color-x":
    case "border-color-y":
    case "border-color-s":
    case "border-color-e":
    case "border-color-t":
    case "border-color-r":
    case "border-color-b":
    case "border-color-l":
      return 9;

    // Transitions
    case "transition":
      return 1;
    case "duration":
      return 2;
    case "ease":
      return 3;
    case "delay":
      return 4;
    default:
      return 5;
  }
}

const SHORTHAND_AXIS_MAP = Object.freeze({
  p: ["pt", "pr", "pb", "pl"],
  px: ["pl", "pr"],
  py: ["pt", "pb"],
  ps: ["pl", "pr"],
  pe: ["pl", "pr"],
  m: ["mt", "mr", "mb", "ml"],
  mx: ["ml", "mr"],
  my: ["mt", "mb"],
  ms: ["ml", "mr"],
  me: ["ml", "mr"],
  inset: ["top", "right", "bottom", "left"],
  "inset-x": ["left", "right"],
  "inset-y": ["top", "bottom"],
  start: ["left", "right"],
  end: ["left", "right"],
  size: ["w", "h"],
  gap: ["gap-x", "gap-y"],
  overflow: ["overflow-x", "overflow-y"],
  overscroll: ["overscroll-x", "overscroll-y"],
  "text-size": ["font-size", "leading"],
  rounded: ["rounded-tl", "rounded-tr", "rounded-br", "rounded-bl"],
  "rounded-t": ["rounded-tl", "rounded-tr"],
  "rounded-r": ["rounded-tr", "rounded-br"],
  "rounded-b": ["rounded-br", "rounded-bl"],
  "rounded-l": ["rounded-tl", "rounded-bl"],
  "rounded-s": ["rounded-tl", "rounded-tr", "rounded-br", "rounded-bl"],
  "rounded-e": ["rounded-tl", "rounded-tr", "rounded-br", "rounded-bl"],
  "border-width": ["border-width-t", "border-width-r", "border-width-b", "border-width-l"],
  "border-width-x": ["border-width-l", "border-width-r"],
  "border-width-y": ["border-width-t", "border-width-b"],
  "border-width-s": ["border-width-l", "border-width-r"],
  "border-width-e": ["border-width-l", "border-width-r"],
  "border-color": ["border-color-t", "border-color-r", "border-color-b", "border-color-l"],
  "border-color-x": ["border-color-l", "border-color-r"],
  "border-color-y": ["border-color-t", "border-color-b"],
  "border-color-s": ["border-color-l", "border-color-r"],
  "border-color-e": ["border-color-l", "border-color-r"],
});

/**
 * Expand a variant-scoped property group (e.g. `md:px` or `p`) into the
 * underlying atomic CSS property axes it mutates so shorthand/longhand
 * collisions are caught accurately.
 * @param {string} scopedPropertyGroup
 * @returns {string[]}
 */
function expandCssAxes(scopedPropertyGroup) {
  if (!scopedPropertyGroup) return [];
  const lastColon = scopedPropertyGroup.lastIndexOf(":");
  const variantScope = lastColon === -1 ? "" : scopedPropertyGroup.slice(0, lastColon + 1);
  const baseProp =
    lastColon === -1 ? scopedPropertyGroup : scopedPropertyGroup.slice(lastColon + 1);
  const leaves = SHORTHAND_AXIS_MAP[baseProp] || [baseProp];
  return leaves.map((leaf) => `${variantScope}${leaf}`);
}

/**
 * Deduplicate and canonically sort an array or whitespace-separated string
 * of Tailwind tokens, separating `@apply`-eligible Tailwind utilities from
 * inline-only tokens (such as `group`, `peer`, `js-*`, or custom BEM classes).
 *
 * @param {string | string[]} input
 * @param {{
 *   tailwindPrefix?: string,
 *   isExcludedToken?: (token: string) => boolean,
 *   isIncludedToken?: (token: string) => boolean
 * }} [options]
 */
function partitionAndCanonicalize(input, options = {}) {
  const rawTokens = Array.isArray(input) ? input : splitClassTokens(input);
  const seen = new Set();
  const applyableInfos = [];
  const inlineTokens = [];
  const allTailwindTokens = [];

  for (const raw of rawTokens) {
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);

    const info = classifyToken(raw, options);
    if (info.isTailwind) {
      allTailwindTokens.push(info);
    }

    const excluded = options.isExcludedToken ? options.isExcludedToken(raw) : false;
    const included = options.isIncludedToken ? options.isIncludedToken(raw) : true;

    if (info.isTailwind && info.isApplyable && !excluded && included) {
      applyableInfos.push(info);
    } else {
      inlineTokens.push(raw);
    }
  }

  applyableInfos.sort((a, b) => (a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0));

  const canonicalTokens = applyableInfos.map((i) => i.raw);
  return {
    canonicalTokens,
    canonicalKey: canonicalTokens.join(" "),
    applyableInfos,
    inlineTokens,
    allTailwindTokens,
  };
}

/**
 * Convenience helper returning the canonical space-separated Tailwind utility
 * string for a given class string.
 * @param {string} classString
 * @param {{ tailwindPrefix?: string }} [options]
 * @returns {string}
 */
function canonicalizeClasses(classString, options = {}) {
  const { canonicalTokens, inlineTokens } = partitionAndCanonicalize(classString, options);
  return [...canonicalTokens, ...inlineTokens].join(" ");
}

module.exports = {
  splitClassTokens,
  splitTopLevelColons,
  classifyToken,
  computeSubPriority,
  expandCssAxes,
  partitionAndCanonicalize,
  canonicalizeClasses,
};
