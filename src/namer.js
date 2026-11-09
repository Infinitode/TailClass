"use strict";

const { matchesAnyGlob } = require("./glob");
const { sanitizeClassPrefix } = require("./css-safety");

const DANGER_HUES = new Set(["red", "rose"]);
const SUCCESS_HUES = new Set(["green", "emerald", "teal", "lime"]);
const WARNING_HUES = new Set(["amber", "yellow", "orange"]);
const INFO_HUES = new Set(["blue", "sky", "cyan"]);
const NEUTRAL_HUES = new Set(["slate", "gray", "zinc", "neutral", "stone"]);
const BRAND_HUES = new Set(["indigo", "violet", "purple", "fuchsia", "blue", "sky", "emerald", "teal", "pink"]);

/**
 * Extract rich visual and structural features from a pattern's Tailwind tokens
 * and DOM occurrence contexts.
 * @param {object} pattern
 */
function extractSignals(pattern) {
  const tokens = pattern.canonicalTokens || [];
  const tokenSet = new Set(tokens);
  const occurrences = pattern.occurrences || [];

  // Aggregate tag, parentTag, ancestor, and attribute counts
  const tagCounts = new Map();
  const rawTagCounts = new Map();
  const parentCounts = new Map();
  const ancestorSet = new Set();
  const roles = new Set();
  const inputTypes = new Set();
  const ariaLabels = [];

  for (const occ of occurrences) {
    if (occ.tag) tagCounts.set(occ.tag, (tagCounts.get(occ.tag) || 0) + 1);
    if (occ.rawTag) rawTagCounts.set(occ.rawTag, (rawTagCounts.get(occ.rawTag) || 0) + 1);
    if (occ.parentTag) parentCounts.set(occ.parentTag, (parentCounts.get(occ.parentTag) || 0) + 1);
    for (const anc of occ.ancestors || []) ancestorSet.add(anc);

    const attrs = occ.attributes || {};
    if (attrs.role) roles.add(String(attrs.role).toLowerCase());
    if (attrs.type) inputTypes.add(String(attrs.type).toLowerCase());
    if (attrs["aria-label"]) ariaLabels.push(String(attrs["aria-label"]).toLowerCase());
    if (attrs["aria-modal"] === "true") roles.add("dialog");
  }

  const dominantTag = getTopKey(tagCounts) || "div";
  const dominantRawTag = getTopKey(rawTagCounts) || dominantTag;
  const dominantParent = getTopKey(parentCounts) || null;

  // Analyze base (unprefixed) and variant-prefixed utilities
  let isFlex = false;
  let isInlineFlex = false;
  let isGrid = false;
  let isCol = false;
  let justifyBetween = false;
  let justifyCenter = false;
  let itemsCenter = false;
  let isSticky = false;
  let isFixed = false;
  let isAbsolute = false;
  let isTopZero = false;
  let isBottomZero = false;
  let isInsetZero = false;
  let highZ = false;
  let isHiddenBase = false;
  let hasResponsiveFlexOrBlock = false;
  let hasMobileOnlyHide = false;
  let maxGridCols = 0;

  let hasContainerWidth = false;
  let hasMxAuto = false;
  let isFullScreenHeight = false;
  let isFullWidth = false;
  let hasSidebarWidth = false;
  let isSmallSquare = false;

  let largePy = false;
  let mediumPy = false;
  let compactPad = false;
  let buttonPad = false;
  let cardPad = false;

  let roundedFull = false;
  let roundedCard = false;
  let roundedAny = false;
  let hasBorder = false;
  let hasBorderB = false;
  let hasBorderT = false;
  let hasBorderR = false;
  let hasBorderLAccent = false;
  let hasDivide = false;
  let hasRing = false;
  let hasFocusRing = false;
  let hasShadow = false;
  let hasHeavyShadow = false;
  let hasBackdropBlur = false;
  let hasOverlayBg = false;

  let bgHue = null;
  let bgShade = null;
  let bgIsWhite = false;
  let bgIsDarkSurface = false;
  let bgIsSolidAccent = false;
  let bgIsSoftTint = false;
  let hasGradient = false;

  let textHue = null;
  let textShade = null;
  let textIsWhite = false;
  let textSize = null;
  let fontWeight = null;
  let isUppercase = false;
  let isMono = false;
  let isTruncate = false;
  let isUnderline = false;

  let hasHover = false;
  let hasTransition = false;
  let isAnimatePulse = false;
  let isAnimateSpin = false;

  const widthTokens = [];
  const heightTokens = [];

  for (const tok of tokens) {
    if (tok.includes(":")) {
      if (tok.startsWith("hover:") || tok.includes(":hover:")) hasHover = true;
      if (/^(?:focus|focus-visible|focus-within):(?:ring|outline|border)/.test(tok)) {
        hasFocusRing = true;
      }
      if (/^(?:sm|md|lg|xl):(?:flex|inline-flex|block|grid)$/.test(tok)) {
        hasResponsiveFlexOrBlock = true;
      }
      if (/^(?:sm|md|lg|xl):hidden$/.test(tok)) {
        hasMobileOnlyHide = true;
      }
      const respGrid = tok.match(/grid-cols-([0-9]+)/);
      if (respGrid) {
        maxGridCols = Math.max(maxGridCols, Number(respGrid[1]));
      }
      continue;
    }

    const clean = tok.replace(/^!/, "").replace(/!$/, "");

    if (clean === "flex" || clean === "inline-flex") isFlex = true;
    if (clean === "inline-flex") isInlineFlex = true;
    if (clean === "grid" || clean === "inline-grid") isGrid = true;
    if (clean === "flex-col") isCol = true;
    if (clean === "justify-between") justifyBetween = true;
    if (clean === "justify-center") justifyCenter = true;
    if (clean === "items-center") itemsCenter = true;
    if (clean === "sticky") isSticky = true;
    if (clean === "fixed") isFixed = true;
    if (clean === "absolute") isAbsolute = true;
    if (clean === "top-0" || clean === "inset-x-0") isTopZero = true;
    if (clean === "bottom-0") isBottomZero = true;
    if (clean === "inset-0") isInsetZero = true;
    if (/^z-(?:30|40|50|\[.+\])$/.test(clean)) highZ = true;
    if (clean === "hidden") isHiddenBase = true;

    const gridMatch = clean.match(/^grid-cols-([0-9]+)$/);
    if (gridMatch) maxGridCols = Math.max(maxGridCols, Number(gridMatch[1]));

    if (clean === "container" || /^max-w-(?:4xl|5xl|6xl|7xl|screen-(?:lg|xl|2xl))$/.test(clean)) {
      hasContainerWidth = true;
    }
    if (clean === "mx-auto") hasMxAuto = true;
    if (clean === "min-h-screen" || clean === "h-screen" || clean === "min-h-dvh") {
      isFullScreenHeight = true;
    }
    if (clean === "w-full") isFullWidth = true;
    if (/^w-(?:52|56|60|64|72|80)$/.test(clean)) hasSidebarWidth = true;

    if (/^size-(?:[4-9]|1[0-6])$/.test(clean)) isSmallSquare = true;
    if (/^w-(?:[4-9]|1[0-6])$/.test(clean)) widthTokens.push(clean.slice(2));
    if (/^h-(?:[4-9]|1[0-6])$/.test(clean)) heightTokens.push(clean.slice(2));

    if (/^(?:py|pt)-(?:16|20|24|28|32|36|40)$/.test(clean)) largePy = true;
    if (/^py-(?:10|12|14)$/.test(clean)) mediumPy = true;
    if (/^px-(?:1\.5|2|2\.5|3)$/.test(clean) || /^py-(?:0\.5|1)$/.test(clean)) compactPad = true;
    if (/^px-(?:3|3\.5|4|5|6|8)$/.test(clean)) buttonPad = true;
    if (/^p-(?:4|5|6|7|8|10)$/.test(clean)) cardPad = true;

    if (clean === "rounded-full") {
      roundedFull = true;
      roundedAny = true;
    } else if (/^rounded-(?:lg|xl|2xl|3xl)$/.test(clean)) {
      roundedCard = true;
      roundedAny = true;
    } else if (clean.startsWith("rounded")) {
      roundedAny = true;
    }

    if (clean === "border" || /^border-[248]$/.test(clean)) hasBorder = true;
    if (clean === "border-b" || clean.startsWith("border-b-")) hasBorderB = true;
    if (clean === "border-t" || clean.startsWith("border-t-")) hasBorderT = true;
    if (clean === "border-r" || clean.startsWith("border-r-")) hasBorderR = true;
    if (/^border-l-[248]$/.test(clean)) hasBorderLAccent = true;
    if (clean.startsWith("divide-")) hasDivide = true;
    if (clean === "ring" || /^ring-[124]$/.test(clean)) hasRing = true;

    if (clean === "shadow" || clean.startsWith("shadow-")) {
      hasShadow = true;
      if (/^shadow-(?:lg|xl|2xl)$/.test(clean)) hasHeavyShadow = true;
    }
    if (clean === "backdrop-blur" || clean.startsWith("backdrop-blur-")) {
      hasBackdropBlur = true;
    }

    if (/^bg-(?:black|slate-900|slate-950|gray-900|zinc-900)\/[0-9]+$/.test(clean)) {
      hasOverlayBg = true;
    }
    if (clean.startsWith("bg-gradient-") || clean.startsWith("bg-linear-")) {
      hasGradient = true;
    }
    if (clean === "bg-white" || clean.startsWith("bg-white/")) {
      bgIsWhite = true;
    }
    if (clean === "bg-black") {
      bgIsDarkSurface = true;
      bgIsSolidAccent = true;
      bgHue = "black";
    }

    const bgColorMatch = clean.match(/^bg-([a-z]+)-(50|[1-9]00|950)(?:\/([0-9]+))?$/);
    if (bgColorMatch) {
      bgHue = bgColorMatch[1];
      bgShade = Number(bgColorMatch[2]);
      const alpha = bgColorMatch[3] ? Number(bgColorMatch[3]) : 100;
      if (bgShade >= 800 && NEUTRAL_HUES.has(bgHue) && alpha >= 80) {
        bgIsDarkSurface = true;
        bgIsSolidAccent = true;
      } else if (bgShade >= 500 && bgShade <= 700 && alpha >= 80) {
        bgIsSolidAccent = true;
      } else if (bgShade <= 100 || alpha <= 25) {
        bgIsSoftTint = true;
      }
    }

    if (clean === "text-white") textIsWhite = true;
    const textColorMatch = clean.match(/^text-([a-z]+)-(50|[1-9]00|950)$/);
    if (textColorMatch) {
      textHue = textColorMatch[1];
      textShade = Number(textColorMatch[2]);
    }

    const textSizeMatch = clean.match(/^text-(xs|sm|base|lg|xl|[2-9]xl)(?:\/.+)?$/);
    if (textSizeMatch) textSize = textSizeMatch[1];

    const weightMatch = clean.match(/^font-(medium|semibold|bold|extrabold|black)$/);
    if (weightMatch) fontWeight = weightMatch[1];

    if (clean === "uppercase") isUppercase = true;
    if (clean === "font-mono") isMono = true;
    if (clean === "truncate") isTruncate = true;
    if (clean === "underline") isUnderline = true;
    if (clean === "transition" || clean.startsWith("transition-")) hasTransition = true;
    if (clean === "animate-pulse") isAnimatePulse = true;
    if (clean === "animate-spin") isAnimateSpin = true;
  }

  if (widthTokens.length > 0 && heightTokens.length > 0 && widthTokens[0] === heightTokens[0]) {
    isSmallSquare = true;
  }

  const hasPyButton = tokens.some((t) => /^py-(?:1\.5|2|2\.5|3|3\.5|4)$/.test(t));

  return {
    tokens,
    tokenSet,
    dominantTag,
    dominantRawTag,
    dominantParent,
    ancestorSet,
    roles,
    inputTypes,
    ariaLabels,
    isFlex,
    isInlineFlex,
    isGrid,
    isCol,
    justifyBetween,
    justifyCenter,
    itemsCenter,
    isSticky,
    isFixed,
    isAbsolute,
    isTopZero,
    isBottomZero,
    isInsetZero,
    highZ,
    isHiddenBase,
    hasResponsiveFlexOrBlock,
    hasMobileOnlyHide,
    maxGridCols,
    hasContainerWidth,
    hasMxAuto,
    isFullScreenHeight,
    isFullWidth,
    hasSidebarWidth,
    isSmallSquare,
    largePy,
    mediumPy,
    compactPad,
    buttonPad: buttonPad && hasPyButton,
    cardPad,
    roundedFull,
    roundedCard,
    roundedAny,
    hasBorder,
    hasBorderB,
    hasBorderT,
    hasBorderR,
    hasBorderLAccent,
    hasDivide,
    hasRing,
    hasFocusRing,
    hasShadow,
    hasHeavyShadow,
    hasBackdropBlur,
    hasOverlayBg,
    bgHue,
    bgShade,
    bgIsWhite,
    bgIsDarkSurface,
    bgIsSolidAccent,
    bgIsSoftTint,
    hasGradient,
    textHue,
    textShade,
    textIsWhite,
    textSize,
    fontWeight,
    isUppercase,
    isMono,
    isTruncate,
    isUnderline,
    hasHover,
    hasTransition,
    isAnimatePulse,
    isAnimateSpin,
  };
}

function getTopKey(map) {
  let bestKey = null;
  let bestVal = -1;
  for (const [k, v] of map.entries()) {
    if (v > bestVal) {
      bestVal = v;
      bestKey = k;
    }
  }
  return bestKey;
}

/**
 * Evaluate custom user rules from `config.rules` if any match.
 */
function matchCustomRules(signals, config) {
  const rules = Array.isArray(config?.rules) ? [...config.rules] : [];
  if (rules.length === 0) return null;

  rules.sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0));

  for (const rule of rules) {
    if (!rule || !rule.name) continue;

    if (Array.isArray(rule.matchTag) && rule.matchTag.length > 0) {
      const allowed = rule.matchTag.map((t) => String(t).toLowerCase());
      if (!allowed.includes(signals.dominantTag)) continue;
    }

    if (Array.isArray(rule.matchParent) && rule.matchParent.length > 0) {
      const allowedP = rule.matchParent.map((t) => String(t).toLowerCase());
      if (!signals.dominantParent || !allowedP.includes(signals.dominantParent)) continue;
    }

    if (Array.isArray(rule.mustInclude) && rule.mustInclude.length > 0) {
      const allPresent = rule.mustInclude.every((glob) =>
        signals.tokens.some((tok) => matchesAnyGlob(tok, [glob]))
      );
      if (!allPresent) continue;
    }

    if (Array.isArray(rule.mustIncludeAny) && rule.mustIncludeAny.length > 0) {
      const anyPresent = rule.mustIncludeAny.some((glob) =>
        signals.tokens.some((tok) => matchesAnyGlob(tok, [glob]))
      );
      if (!anyPresent) continue;
    }

    if (Array.isArray(rule.mustExclude) && rule.mustExclude.length > 0) {
      const excludedHit = rule.mustExclude.some((glob) =>
        signals.tokens.some((tok) => matchesAnyGlob(tok, [glob]))
      );
      if (excludedHit) continue;
    }

    return {
      baseName: sanitizeKebab(rule.name),
      category: rule.category || "custom",
      label: rule.label || rule.name,
      confidence: 0.99,
      signals,
    };
  }

  return null;
}

/**
 * Infer a smart semantic component/layout name, category, human label, and
 * confidence score from a pattern's visual utilities and DOM context.
 *
 * @param {object} pattern
 * @param {Record<string, any>} [config]
 */
function inferSemanticName(pattern, config = {}) {
  const s = extractSignals(pattern);

  const customHit = matchCustomRules(s, config);
  if (customHit) return customHit;

  // 1. Loading & Feedback Animations
  if (s.isAnimateSpin && s.roundedFull) {
    return result("spinner", "feedback", "Loading Spinner", 0.95, s);
  }
  if (s.isAnimatePulse) {
    return result("skeleton", "feedback", "Skeleton Placeholder", 0.93, s);
  }

  // 2. Overlays & Modals
  if (s.isFixed && s.isInsetZero && (s.hasOverlayBg || s.hasBackdropBlur) && !s.cardPad) {
    return result("modal-backdrop", "overlay", "Modal Backdrop Overlay", 0.96, s);
  }
  if (
    s.dominantTag === "dialog" ||
    s.roles.has("dialog") ||
    (s.isFixed && s.highZ && s.roundedCard && s.hasHeavyShadow && (s.bgIsWhite || s.bgIsDarkSurface))
  ) {
    return result("modal-dialog", "overlay", "Modal Dialog Panel", 0.94, s);
  }

  // 3. Navigation, Header, Sidebar & Footer
  if (
    s.dominantTag === "nav" ||
    s.roles.has("navigation") ||
    (s.dominantTag === "header" && s.isFlex && s.justifyBetween && s.itemsCenter)
  ) {
    if (s.ariaLabels.some((l) => l.includes("breadcrumb"))) {
      return result("breadcrumb", "navigation", "Breadcrumb Navigation", 0.95, s);
    }
    if (s.isCol && s.hasSidebarWidth) {
      return result("sidebar-nav", "navigation", "Sidebar Navigation", 0.93, s);
    }
    return result("navbar", "navigation", "Navigation Bar", 0.96, s);
  }

  if (
    s.dominantTag === "header" &&
    (s.isSticky || s.isFixed || s.hasBorderB || s.hasBackdropBlur || s.hasShadow)
  ) {
    return result("site-header", "navigation", "Site Header", 0.94, s);
  }

  if (
    (s.isSticky || s.isFixed) &&
    s.isTopZero &&
    s.highZ &&
    (s.isFlex || s.hasBorderB || s.hasBackdropBlur)
  ) {
    return result("navbar", "navigation", "Sticky Top Navigation Bar", 0.91, s);
  }

  if (
    s.dominantTag === "aside" ||
    (s.hasSidebarWidth && (s.isCol || s.isFullScreenHeight || s.hasBorderR))
  ) {
    return result("sidebar", "navigation", "Sidebar Panel", 0.93, s);
  }

  if (s.dominantTag === "footer" && (s.hasBorderT || s.bgIsDarkSurface || s.mediumPy || s.largePy)) {
    return result("site-footer", "layout", "Site Footer", 0.95, s);
  }

  // Children of <nav> / <header>
  if (s.ancestorSet.has("nav") || s.dominantParent === "nav") {
    if (
      (s.dominantTag === "ul" || s.dominantTag === "div") &&
      (s.isFlex || s.hasResponsiveFlexOrBlock) &&
      !s.buttonPad
    ) {
      if (s.isHiddenBase && s.hasResponsiveFlexOrBlock) {
        return result("nav-menu", "navigation", "Desktop Navigation Menu", 0.92, s);
      }
      if (s.hasMobileOnlyHide) {
        return result("mobile-menu", "navigation", "Mobile Navigation Menu", 0.91, s);
      }
      return result("nav-list", "navigation", "Navigation List", 0.9, s);
    }

    if (
      (s.dominantTag === "a" || s.dominantTag === "span") &&
      (s.fontWeight === "bold" || s.fontWeight === "extrabold" || s.textSize === "xl" || s.textSize === "2xl")
    ) {
      return result("navbar-brand", "navigation", "Navigation Brand", 0.94, s);
    }

    if (s.dominantTag === "a" && !s.bgIsSolidAccent && !s.buttonPad) {
      return result("nav-link", "navigation", "Navigation Link", 0.94, s);
    }
  }

  // 4. Tables
  if (s.dominantTag === "table") {
    return result("data-table", "data-display", "Data Table", 0.95, s);
  }
  if (s.dominantTag === "thead") {
    return result("table-head", "data-display", "Table Header Group", 0.94, s);
  }
  if (s.dominantTag === "th") {
    return result("table-header-cell", "data-display", "Table Header Cell", 0.95, s);
  }
  if (s.dominantTag === "td") {
    return result("table-cell", "data-display", "Table Body Cell", 0.95, s);
  }
  if (s.dominantTag === "tr") {
    return result("table-row", "data-display", "Table Row", 0.93, s);
  }

  // 5. Forms & Inputs
  if (s.dominantTag === "form") {
    return result("form-layout", "forms", "Form Container", 0.91, s);
  }
  if (s.dominantTag === "input") {
    if (s.inputTypes.has("checkbox") || s.inputTypes.has("radio")) {
      return result("form-checkbox", "forms", "Form Checkbox / Radio", 0.95, s);
    }
    if (s.inputTypes.has("search")) {
      return result("search-input", "forms", "Search Input", 0.94, s);
    }
    return result("form-input", "forms", "Form Text Input", 0.96, s);
  }
  if (s.dominantTag === "select") {
    return result("form-select", "forms", "Form Select Dropdown", 0.96, s);
  }
  if (s.dominantTag === "textarea") {
    return result("form-textarea", "forms", "Form Textarea", 0.96, s);
  }
  if (s.dominantTag === "label") {
    return result("form-label", "forms", "Form Field Label", 0.95, s);
  }

  // 6. Buttons & Interactive Controls
  const looksLikeButton =
    s.dominantTag === "button" ||
    s.inputTypes.has("submit") ||
    s.inputTypes.has("button") ||
    (s.dominantTag === "a" &&
      s.roundedAny &&
      (s.buttonPad || s.bgIsSolidAccent || (s.hasBorder && s.hasHover)) &&
      (s.isInlineFlex || s.isFlex || Boolean(s.fontWeight)));

  if (looksLikeButton) {
    if (s.isSmallSquare && !s.buttonPad) {
      return result("icon-btn", "controls", "Icon Button", 0.92, s);
    }
    if (s.bgIsSolidAccent && DANGER_HUES.has(s.bgHue)) {
      return result("btn-danger", "controls", "Danger Button", 0.95, s);
    }
    if (s.bgIsSolidAccent || s.hasGradient) {
      return result("btn-primary", "controls", "Primary Action Button", 0.95, s);
    }
    if (s.hasBorder || s.hasRing) {
      return result("btn-outline", "controls", "Outline Secondary Button", 0.93, s);
    }
    if (s.bgIsSoftTint) {
      return result("btn-soft", "controls", "Soft Tinted Button", 0.91, s);
    }
    return result("btn-ghost", "controls", "Ghost Button", 0.89, s);
  }

  // 7. Alerts / Callouts
  if (
    s.roles.has("alert") ||
    (s.hasBorderLAccent && s.roundedAny && (s.bgIsSoftTint || s.cardPad))
  ) {
    const tone = getSemanticTone(s.bgHue || s.textHue);
    return result(
      tone ? `alert-${tone}` : "alert-box",
      "feedback",
      "Alert Callout",
      0.92,
      s
    );
  }

  // 8. Badges / Pills / Tags
  if (
    (s.dominantTag === "span" || s.dominantTag === "div") &&
    (s.roundedFull || s.roundedAny) &&
    s.compactPad &&
    (s.textSize === "xs" || s.textSize === "sm") &&
    (s.bgIsSoftTint || s.bgIsSolidAccent || s.hasBorder || s.hasRing)
  ) {
    const tone = getSemanticTone(s.bgHue || s.textHue);
    return result(
      tone && tone !== "brand" ? `badge-${tone}` : "badge",
      "data-display",
      "Status Badge",
      0.93,
      s
    );
  }

  // 9. Avatars & Feature Icon Boxes
  if (s.dominantTag === "img" && s.roundedFull && s.isSmallSquare) {
    return result("avatar", "data-display", "User Avatar", 0.96, s);
  }
  if (
    s.isSmallSquare &&
    s.isFlex &&
    s.itemsCenter &&
    s.justifyCenter &&
    s.roundedAny &&
    (s.bgIsSoftTint || s.bgIsSolidAccent || s.hasBorder)
  ) {
    return result(
      s.roundedFull ? "avatar-badge" : "icon-box",
      "data-display",
      "Feature Icon Box",
      0.92,
      s
    );
  }

  // 10. Dividers
  if (s.dominantTag === "hr" || (s.hasBorderT && s.tokens.length <= 4 && !s.cardPad)) {
    return result("divider", "layout", "Section Divider", 0.92, s);
  }

  // 11. Typography Archetypes
  if (s.dominantTag === "h1" || (s.textSize && /^[4-9]xl$/.test(s.textSize) && s.fontWeight)) {
    return result("hero-title", "typography", "Hero Display Heading", 0.94, s);
  }
  if (s.dominantTag === "h2" || ((s.textSize === "2xl" || s.textSize === "3xl") && s.fontWeight)) {
    return result("section-title", "typography", "Section Heading", 0.93, s);
  }
  if (
    s.dominantTag === "h3" ||
    s.dominantTag === "h4" ||
    ((s.textSize === "lg" || s.textSize === "xl") && (s.fontWeight === "semibold" || s.fontWeight === "bold"))
  ) {
    return result("card-title", "typography", "Card / Subsection Heading", 0.9, s);
  }
  if (s.isUppercase && (s.textSize === "xs" || s.textSize === "sm") && s.fontWeight) {
    return result("eyebrow", "typography", "Eyebrow Kicker Label", 0.92, s);
  }
  if (s.dominantTag === "code" || (s.isMono && s.roundedAny && !s.cardPad)) {
    return result("inline-code", "typography", "Inline Code Snippet", 0.93, s);
  }
  if (s.dominantTag === "pre" || (s.isMono && s.cardPad)) {
    return result("code-block", "typography", "Code Block", 0.93, s);
  }
  if (s.dominantTag === "blockquote") {
    return result("blockquote", "typography", "Blockquote", 0.94, s);
  }
  if (s.dominantTag === "a" && (s.isUnderline || s.hasHover)) {
    return result("text-link", "typography", "Inline Text Link", 0.89, s);
  }
  if (s.dominantTag === "p" && (s.textSize === "lg" || s.textSize === "xl")) {
    return result("lead-text", "typography", "Lead Paragraph", 0.9, s);
  }
  if ((s.dominantTag === "p" || s.dominantTag === "span") && !s.isFlex && !s.isGrid && !s.cardPad) {
    return result(
      s.textSize === "xs" || s.textSize === "sm" ? "muted-text" : "body-text",
      "typography",
      "Body Text",
      0.85,
      s
    );
  }

  // 12. Page Containers, Hero Sections & Structural Layouts
  if (s.isFullScreenHeight && s.isFlex && s.isCol) {
    return result("page-shell", "layout", "Page Shell Wrapper", 0.93, s);
  }
  if (s.hasContainerWidth && s.hasMxAuto) {
    return result("content-container", "layout", "Centered Content Container", 0.95, s);
  }
  if ((s.dominantTag === "section" || s.dominantTag === "div") && s.largePy) {
    return result("hero-section", "layout", "Hero Section", 0.91, s);
  }
  if (s.dominantTag === "section" && s.mediumPy) {
    return result("section-block", "layout", "Page Section", 0.9, s);
  }

  // 13. Cards & Surface Panels
  if (
    (s.dominantTag === "article" || s.dominantTag === "div" || s.dominantTag === "li") &&
    s.roundedCard &&
    (s.hasBorder || s.hasShadow || s.hasRing) &&
    (s.bgIsWhite || s.bgIsDarkSurface || s.bgIsSoftTint || s.cardPad)
  ) {
    return result("card", "surfaces", "Surface Card", 0.94, s);
  }

  // 14. Grid & Flex Geometries
  if (s.isGrid) {
    if (s.maxGridCols >= 2) {
      return result(`grid-${s.maxGridCols}col`, "layout", `${s.maxGridCols}-Column Grid`, 0.91, s);
    }
    return result("grid-layout", "layout", "Grid Layout", 0.86, s);
  }

  if (s.isFlex) {
    if (s.isCol) {
      return result("vstack", "layout", "Vertical Flex Stack", 0.86, s);
    }
    if (s.justifyBetween && s.itemsCenter) {
      return result("flex-between", "layout", "Horizontal Split Bar", 0.88, s);
    }
    if (s.justifyCenter && s.itemsCenter) {
      return result("flex-center", "layout", "Centered Flex Box", 0.88, s);
    }
    if (s.itemsCenter) {
      return result("inline-row", "layout", "Aligned Flex Row", 0.85, s);
    }
    return result("flex-row", "layout", "Flex Row", 0.82, s);
  }

  // 15. PascalCase JSX Component Hint fallback (e.g., `<FeatureTile>` -> `feature-tile`)
  if (s.dominantRawTag && /^[A-Z]/.test(s.dominantRawTag)) {
    const kebabComp = pascalToKebab(s.dominantRawTag);
    return result(kebabComp, "components", `${s.dominantRawTag} Component`, 0.84, s);
  }

  // 16. Clean fallback
  if (s.roundedAny && (s.bgIsWhite || s.bgIsDarkSurface || s.bgIsSoftTint)) {
    return result("surface-box", "surfaces", "Surface Box", 0.78, s);
  }

  return result(`${ sanitizeKebab(s.dominantTag) }-block`, "layout", "Layout Block", 0.72, s);
}

function result(baseName, category, label, confidence, signals) {
  return { baseName, category, label, confidence, signals };
}

function getSemanticTone(hue) {
  if (!hue) return null;
  if (DANGER_HUES.has(hue)) return "danger";
  if (SUCCESS_HUES.has(hue)) return "success";
  if (WARNING_HUES.has(hue)) return "warning";
  if (INFO_HUES.has(hue)) return "info";
  if (NEUTRAL_HUES.has(hue)) return "neutral";
  if (BRAND_HUES.has(hue)) return "brand";
  return hue;
}

function pascalToKebab(str) {
  return sanitizeKebab(
    String(str)
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .toLowerCase()
  );
}

function sanitizeKebab(str) {
  return (
    String(str || "component")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "") || "component"
  );
}

/**
 * Format a kebab-case semantic identifier according to user `namingStyle` and `classPrefix`.
 * @param {string} kebabName
 * @param {{ classPrefix?: string, namingStyle?: "kebab" | "bem" | "camel" }} [config]
 */
function formatClassName(kebabName, config = {}) {
  const clean = sanitizeKebab(kebabName);
  // Sanitised again here (config validation rejects bad prefixes) so a hostile or
  // malformed prefix can never reach a CSS selector or a markup class attribute.
  const prefix = sanitizeClassPrefix(config.classPrefix || "");
  const style = config.namingStyle || "kebab";

  let formatted = clean;
  if (style === "camel") {
    formatted = clean.replace(/-([a-z0-9])/g, (_, ch) => ch.toUpperCase());
  } else if (style === "bem") {
    const parts = clean.split("-");
    if (parts.length >= 2) {
      const modifiers = new Set([
        "primary",
        "secondary",
        "outline",
        "ghost",
        "danger",
        "success",
        "warning",
        "info",
        "neutral",
        "dark",
        "compact",
        "elevated",
        "active",
        "sm",
        "lg",
      ]);
      const last = parts[parts.length - 1];
      if (modifiers.has(last)) {
        formatted = `${parts.slice(0, -1).join("-")}--${last}`;
      } else {
        formatted = `${parts[0]}__${parts.slice(1).join("-")}`;
      }
    }
  }

  return `${prefix}${formatted}`;
}

/**
 * Derive a descriptive visual modifier when two patterns share the same base
 * archetype name (e.g. `card` vs `card-dark`, `nav-link` vs `nav-link-active`).
 * @param {object} signals
 */
function deriveDistinguishingModifier(signals) {
  if (!signals) return null;
  if (signals.bgIsDarkSurface) return "dark";
  if (signals.hasHeavyShadow) return "elevated";
  if (signals.bgIsSolidAccent && signals.bgHue && BRAND_HUES.has(signals.bgHue)) return "active";
  if (signals.bgIsSoftTint && signals.bgHue) {
    const tone = getSemanticTone(signals.bgHue);
    if (tone && tone !== "neutral") return tone === "brand" ? "tinted" : tone;
  }
  if (signals.compactPad || signals.textSize === "xs") return "sm";
  if (signals.largePy || signals.textSize === "lg" || signals.textSize === "xl") return "lg";
  if (signals.hasBorder && !signals.hasShadow) return "bordered";
  if (signals.roundedFull) return "pill";
  return null;
}

/**
 * Assign unique, collision-free auto names across a list of extracted patterns,
 * avoiding any existing custom class names found in the project.
 *
 * @param {Array<object>} patterns
 * @param {Set<string>} existingCustomClasses
 * @param {Record<string, any>} [config]
 */
function assignUniqueNames(patterns, existingCustomClasses = new Set(), config = {}) {
  const byBase = new Map();
  for (const p of patterns) {
    const info = inferSemanticName(p, config);
    p.semanticInfo = info;
    if (!byBase.has(info.baseName)) byBase.set(info.baseName, []);
    byBase.get(info.baseName).push(p);
  }

  const taken = new Set(existingCustomClasses);

  for (const [baseName, group] of byBase.entries()) {
    // Sort most-frequent pattern first so the primary archetype gets the cleanest name
    group.sort((a, b) => b.timesFound - a.timesFound || b.classCount - a.classCount);

    if (group.length === 1) {
      const p = group[0];
      p.autoName = claimUnique(formatClassName(baseName, config), taken);
      p.category = p.semanticInfo.category;
      p.label = p.semanticInfo.label;
      p.confidence = p.semanticInfo.confidence;
      continue;
    }

    for (let idx = 0; idx < group.length; idx++) {
      const p = group[idx];
      let candidateKebab = baseName;

      if (idx > 0) {
        const mod = deriveDistinguishingModifier(p.semanticInfo.signals);
        if (mod && !baseName.endsWith(`-${mod}`)) {
          candidateKebab = `${baseName}-${mod}`;
        } else {
          candidateKebab = `${baseName}-${idx + 1}`;
        }
      }

      p.autoName = claimUnique(formatClassName(candidateKebab, config), taken);
      p.category = p.semanticInfo.category;
      p.label = p.semanticInfo.label;
      p.confidence = p.semanticInfo.confidence;
    }
  }

  return patterns;
}

function claimUnique(desired, takenSet) {
  if (!takenSet.has(desired)) {
    takenSet.add(desired);
    return desired;
  }
  let n = 2;
  while (takenSet.has(`${desired}-${n}`)) {
    n++;
  }
  const finalName = `${desired}-${n}`;
  takenSet.add(finalName);
  return finalName;
}

module.exports = {
  extractSignals,
  inferSemanticName,
  formatClassName,
  assignUniqueNames,
  sanitizeKebab,
};
