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
  include?: string[];
  exclude?: string[];
  replaceDefaultExcludes?: boolean;
  outputCss?: string;
  dictionaryFile?: string;
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
  clean?: boolean;
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
  dryRun: boolean;
  filesReverted: Array<Record<string, any>>;
  totalFilesReverted: number;
  totalReverted: number;
  classesExpanded: string[];
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
