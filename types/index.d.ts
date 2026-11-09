export type CssFormat = "tailwind-v3" | "tailwind-v4" | "plain";
export type NamingStyle = "kebab" | "bem" | "camel";

export interface CustomNamingRule {
  name: string;
  category?: string;
  label?: string;
  matchTag?: string[];
  matchParent?: string[];
  mustInclude?: string[];
  mustIncludeAny?: string[];
  mustExclude?: string[];
  priority?: number;
}

export interface TailClassConfig {
  configPath?: string;
  /** Non-fatal configuration problems (unknown keys, coerced values). */
  warnings?: string[];
  /** Internal: where each writable path came from (`cli` | `config` | `default`). */
  pathSources?: Partial<Record<"outputCss" | "dictionaryFile" | "manifestFile", string>>;
  include?: string[];
  exclude?: string[];
  replaceDefaultExcludes?: boolean;
  /** Output paths must be regular files inside the project root when config-supplied; symlinked output files are rejected even if the link points inside the root (since 1.0.2). Symlinked directories that resolve inside the root are fine. */
  outputCss?: string;
  /** @see outputCss */
  dictionaryFile?: string;
  /** @see outputCss */
  manifestFile?: string;
  cssFormat?: CssFormat;
  minOccurrences?: number;
  minClasses?: number;
  maxClasses?: number;
  minFiles?: number;
  subsetMatching?: boolean;
  subsetMinClasses?: number;
  classPrefix?: string;
  namingStyle?: NamingStyle;
  tailwindPrefix?: string;
  comments?: boolean;
  groupByCategory?: boolean;
  scanHelpers?: boolean;
  strictDictionary?: boolean;
  excludeClasses?: string[];
  includeClasses?: string[];
  excludePatterns?: string[];
  ignoreTags?: string[];
  onlyTags?: string[];
  rules?: CustomNamingRule[];
}

export interface FileLineSummary {
  file: string;
  count: number;
  lines: number[];
}

export interface PatternMapping {
  id: string;
  autoName: string;
  customName: string;
  finalName?: string;
  enabled?: boolean;
  category: string;
  label: string;
  confidence: number;
  matchType: "exact" | "shared-base";
  classCount: number;
  classes?: string;
  canonicalKey?: string;
  timesFound: number;
  exactMatches: number;
  subsetMatches: number;
  fileCount: number;
  elements: string[];
  files: FileLineSummary[];
}

export interface SiteSummary {
  filesScanned: number;
  filesWithClasses: number;
  totalClassAttributes: number;
  totalUtilityTokens: number;
  uniqueUtilityTokens: number;
  uniqueClassPatterns: number;
  extractablePatterns: number;
  totalReplacementsPossible: number;
}

export interface UtilityInventoryEntry {
  utility: string;
  timesFound: number;
  fileCount: number;
  files: string[];
}

export interface DictionaryPayload {
  $schema: string;
  version: string;
  generatedAt: string;
  instructions: string;
  summary: SiteSummary;
  mappings: PatternMapping[];
  utilityInventory?: UtilityInventoryEntry[];
}

export interface ApplyOptions extends TailClassConfig {
  dryRun?: boolean;
  backup?: boolean;
  /** Allow overwriting an existing non-TailClass stylesheet/manifest. */
  force?: boolean;
  dictionary?: string | Record<string, any>;
  ignoreDictionary?: boolean;
}

export interface ClassListOptions extends TailClassConfig {
  includeAll?: boolean;
  includeUtilityInventory?: boolean;
  merge?: boolean;
  write?: boolean;
  reportFile?: string;
}

export interface RevertOptions extends TailClassConfig {
  dryRun?: boolean;
  /** Only remove files TailClass can verify it generated (unowned files are reported in `cleanupSkipped`). */
  clean?: boolean;
  /** Applies to `apply` overwrites only; never allows `--clean` to delete foreign files. */
  force?: boolean;
}

export const NAME: string;
export const VERSION: string;
export const DEFAULT_CONFIG: Readonly<Required<Omit<TailClassConfig, "configPath" | "replaceDefaultExcludes" | "strictDictionary">>>;

export function scanProject(rootDir?: string, options?: TailClassConfig): {
  config: TailClassConfig;
  scan: Record<string, any>;
  analysis: {
    summary: SiteSummary;
    extractablePatterns: PatternMapping[];
    allPatterns: PatternMapping[];
    utilityInventory: UtilityInventoryEntry[];
  };
};

export function generateClassList(rootDir?: string, options?: ClassListOptions): {
  config: TailClassConfig;
  dictionary: DictionaryPayload;
  dictionaryPath: string;
  reportPath: string | null;
  analysis: Record<string, any>;
};

export function applyAutoClasses(rootDir?: string, options?: ApplyOptions): {
  config: TailClassConfig;
  dryRun: boolean;
  usedDictionary: boolean;
  outputCssPath: string;
  manifestPath: string;
  cssContent: string;
  activeMappings: PatternMapping[];
  filesModified: Array<Record<string, any>>;
  totalFilesModified: number;
  totalReplacements: number;
  totalBytesSaved: number;
};

export function revertProject(rootDir?: string, options?: RevertOptions): {
  config: TailClassConfig;
  dryRun: boolean;
  filesReverted: Array<Record<string, any>>;
  totalFilesReverted: number;
  totalReverted: number;
  classesExpanded: string[];
  /** Absolute paths removed by `--clean`. */
  cleanedFiles: string[];
  /** Reasons why `--clean` deliberately left a file untouched. */
  cleanupSkipped: string[];
};

export function initConfig(rootDir?: string, options?: { force?: boolean; fileName?: string }): {
  configPath: string;
  config: Record<string, any>;
};

export function classifyToken(rawToken: string, options?: { tailwindPrefix?: string }): Record<string, any>;
export function canonicalizeClasses(classString: string, options?: { tailwindPrefix?: string }): string;
export function inferSemanticName(pattern: Record<string, any>, config?: TailClassConfig): Record<string, any>;
export function generateStylesheet(activeMappings: Array<Record<string, any>>, config?: TailClassConfig): string;
export function parseExistingStylesheet(cssText: string): Map<string, string>;
export function rewriteSource(source: string, filePath: string, activeMappings: Array<Record<string, any>>, config?: TailClassConfig): Record<string, any>;
export function revertSource(source: string, filePath: string, classToUtilities: Map<string, string> | Record<string, string>, config?: TailClassConfig): Record<string, any>;
