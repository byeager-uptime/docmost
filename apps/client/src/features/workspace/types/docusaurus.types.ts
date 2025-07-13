export enum DocusaurusSyncInterval {
  MANUAL = 'manual',
  HOURLY = 'hourly',
  DAILY = 'daily',
}

export interface DocusaurusSpaceMapping {
  spaceId: string;
  categoryName: string;
  position: number;
  description?: string;
  collapsed?: boolean;
}

export interface DocusaurusAutoSync {
  enabled: boolean;
  interval: DocusaurusSyncInterval;
}

export interface DocusaurusConfig {
  enabled: boolean;
  sitePath: string;
  baseUrl: string;
  siteTitle?: string;
  landingPageId?: string;
  autoSync: DocusaurusAutoSync;
  spaceMappings: DocusaurusSpaceMapping[];
}

export interface DocusaurusValidation {
  valid: boolean;
  errors: string[];
}

// Phase 3: Intelligent Categorization Types

export interface CategorySuggestion {
  type: 'content-cluster' | 'space-based' | 'keyword-based';
  categoryName: string;
  suggestedSpaces: string[];
  confidence: number; // 0-1 scale
  reasoning: string;
  pages: string[]; // Page IDs in this suggestion
}

export interface ContentHierarchy {
  spaces: SpaceHierarchy[];
  totalPages: number;
  maxDepth: number;
}

export interface SpaceHierarchy {
  spaceId: string;
  spaceName: string;
  totalPages: number;
  rootPages: PageHierarchy[];
  depth: number;
}

export interface PageHierarchy {
  pageId: string;
  title: string;
  children: PageHierarchy[];
  depth: number;
}

export interface ContentAnalysisStats {
  totalSpaces: number;
  totalPages: number;
  averagePagesPerSpace: number;
  topKeywords: [string, number][];
  totalClusters: number;
  averageClusterSize: number;
  hierarchicalPages: number;
  orphanPages: number;
}

export interface ContentAnalysisResult {
  suggestions: CategorySuggestion[];
  hierarchy: ContentHierarchy;
  stats: ContentAnalysisStats;
}

// Phase 4: Sync Service Types

export interface SyncStats {
  totalSpaces: number;
  successfulSpaces: number;
  failedSpaces: number;
  totalPages: number;
  successfulPages: number;
  failedPages: number;
  conflicts: ConflictInfo[];
  errors: string[];
}

export interface ConflictInfo {
  filePath: string;
  type: 'file_exists' | 'newer_version' | 'permission_denied';
  resolution: 'overwrite' | 'skip' | 'merge';
  message: string;
}

export interface SyncResult {
  syncId: string;
  workspaceId: string;
  status: 'success' | 'partial' | 'failed' | 'in_progress';
  startTime: string; // ISO date string
  endTime: string;   // ISO date string
  duration: number;  // milliseconds
  stats: SyncStats;
  configSnapshot: {
    spaceMappings: number;
    autoSyncEnabled: boolean;
    autoSyncInterval: string;
  };
  error?: string;
}