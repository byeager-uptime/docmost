import { Injectable, BadRequestException, Logger, Inject, OnModuleInit } from '@nestjs/common';
import { WorkspaceService } from './workspace.service';
import { DocusaurusConfigDto, DocusaurusSpaceMappingDto, DocusaurusSyncInterval } from '../dto/docusaurus-config.dto';
import { ExportService } from '../../../integrations/export/export.service';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { ExportFormat } from '../../../integrations/export/dto/export-dto';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

const writeFile = promisify(fs.writeFile);
const readFile = promisify(fs.readFile);
const mkdir = promisify(fs.mkdir);
const access = promisify(fs.access);

export interface DocusaurusConfig {
  enabled: boolean;
  sitePath: string;
  baseUrl: string;
  siteTitle?: string;
  autoSync: {
    enabled: boolean;
    interval: DocusaurusSyncInterval;
  };
  spaceMappings: DocusaurusSpaceMappingDto[];
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

export interface ContentAnalysis {
  keywords: [string, number][]; // [keyword, frequency]
  pageTags: Map<string, string[]>;
  relationships: PageRelationship[];
  clusters: ContentCluster[];
}

export interface PageRelationship {
  parentId: string;
  childId: string;
  type: 'hierarchical' | 'reference' | 'cross-link';
}

export interface ContentCluster {
  id: string;
  pages: string[];
  commonTags: string[];
  similarity: number;
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
  startTime: Date;
  endTime: Date;
  duration: number; // milliseconds
  stats: SyncStats;
  configSnapshot: {
    spaceMappings: number;
    autoSyncEnabled: boolean;
    autoSyncInterval: string;
  };
  error?: string;
}

@Injectable()
export class DocusaurusService implements OnModuleInit {
  private readonly logger = new Logger(DocusaurusService.name);

  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly exportService: ExportService,
    private readonly pageRepo: PageRepo,
    @InjectKysely() private readonly db: KyselyDB,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {}

  async onModuleInit() {
    // Initialize scheduled sync jobs for all workspaces with auto-sync enabled
    await this.initializeScheduledSyncs();
  }

  async getDocusaurusConfig(workspaceId: string): Promise<DocusaurusConfig | null> {
    const workspace = await this.workspaceService.findById(workspaceId);
    if (!workspace?.settings) {
      return null;
    }

    const settings = workspace.settings as any;
    return settings.docusaurusConfig || null;
  }

  async updateDocusaurusConfig(
    workspaceId: string,
    config: DocusaurusConfigDto,
  ): Promise<DocusaurusConfig> {
    // Validate site path exists
    if (config.sitePath) {
      try {
        await access(config.sitePath);
      } catch (error) {
        throw new BadRequestException(`Docusaurus site path does not exist: ${config.sitePath}`);
      }
    }

    const workspace = await this.workspaceService.findById(workspaceId);
    const currentSettings = (workspace?.settings as any) || {};
    
    const updatedSettings = {
      ...currentSettings,
      docusaurusConfig: config,
    };

    await this.workspaceService.update(workspaceId, {
      settings: updatedSettings,
    });

    // Update scheduled sync based on new configuration
    await this.updateScheduledSync(workspaceId, config);

    this.logger.log(`Updated Docusaurus config for workspace ${workspaceId}`);
    return config;
  }

  async validateDocusaurusSetup(workspaceId: string): Promise<{ valid: boolean; errors: string[] }> {
    const config = await this.getDocusaurusConfig(workspaceId);
    const errors: string[] = [];

    if (!config) {
      errors.push('Docusaurus configuration not found');
      return { valid: false, errors };
    }

    if (!config.enabled) {
      errors.push('Docusaurus integration is disabled');
    }

    if (!config.sitePath) {
      errors.push('Site path is required');
    } else {
      try {
        await access(config.sitePath);
        
        // Check for essential Docusaurus files
        const requiredFiles = ['package.json', 'docusaurus.config.ts', 'docs'];
        for (const file of requiredFiles) {
          try {
            await access(path.join(config.sitePath, file));
          } catch {
            errors.push(`Missing required file/directory: ${file}`);
          }
        }
      } catch {
        errors.push(`Site path does not exist: ${config.sitePath}`);
      }
    }

    if (!config.baseUrl) {
      errors.push('Base URL is required');
    }

    return { valid: errors.length === 0, errors };
  }

  async getSpaceMappings(workspaceId: string): Promise<DocusaurusSpaceMappingDto[]> {
    const config = await this.getDocusaurusConfig(workspaceId);
    return config?.spaceMappings || [];
  }

  async updateSpaceMapping(
    workspaceId: string,
    spaceId: string,
    mapping: Partial<DocusaurusSpaceMappingDto>,
  ): Promise<DocusaurusSpaceMappingDto[]> {
    const config = await this.getDocusaurusConfig(workspaceId);
    if (!config) {
      throw new BadRequestException('Docusaurus configuration not found');
    }

    const existingMappingIndex = config.spaceMappings.findIndex(m => m.spaceId === spaceId);
    
    if (existingMappingIndex >= 0) {
      // Update existing mapping
      config.spaceMappings[existingMappingIndex] = {
        ...config.spaceMappings[existingMappingIndex],
        ...mapping,
      };
    } else {
      // Create new mapping
      config.spaceMappings.push({
        spaceId,
        categoryName: mapping.categoryName || 'New Category',
        position: mapping.position || config.spaceMappings.length + 1,
        description: mapping.description,
        collapsed: mapping.collapsed || false,
      });
    }

    await this.updateDocusaurusConfig(workspaceId, config);
    return config.spaceMappings;
  }

  async removeSpaceMapping(workspaceId: string, spaceId: string): Promise<DocusaurusSpaceMappingDto[]> {
    const config = await this.getDocusaurusConfig(workspaceId);
    if (!config) {
      throw new BadRequestException('Docusaurus configuration not found');
    }

    config.spaceMappings = config.spaceMappings.filter(m => m.spaceId !== spaceId);
    await this.updateDocusaurusConfig(workspaceId, config);
    return config.spaceMappings;
  }

  async createCategoryMetadata(
    mapping: DocusaurusSpaceMappingDto,
    spaceName: string,
  ): Promise<object> {
    return {
      label: mapping.categoryName || spaceName,
      position: mapping.position || 1,
      link: {
        type: 'generated-index',
        description: mapping.description || `Documentation for ${spaceName}`,
      },
      collapsed: mapping.collapsed || false,
    };
  }

  async ensureDocsDirectory(sitePath: string, categoryPath: string): Promise<string> {
    const fullPath = path.join(sitePath, 'docs', categoryPath);
    
    try {
      await access(fullPath);
    } catch {
      await mkdir(fullPath, { recursive: true });
      this.logger.log(`Created docs directory: ${fullPath}`);
    }
    
    return fullPath;
  }

  async writeDocusaurusCategoryFile(
    sitePath: string,
    categoryPath: string,
    metadata: object,
  ): Promise<void> {
    const docsPath = await this.ensureDocsDirectory(sitePath, categoryPath);
    const categoryFilePath = path.join(docsPath, '_category_.json');
    
    await writeFile(categoryFilePath, JSON.stringify(metadata, null, 2));
    this.logger.log(`Created category file: ${categoryFilePath}`);
  }

  async exportContentToDocusaurus(
    workspaceId: string,
    contentId: string,
    contentType: 'page' | 'space',
    options: {
      includeChildren?: boolean;
      includeAttachments?: boolean;
    }
  ): Promise<{ success: boolean; message: string; filePath?: string }> {
    try {
      const config = await this.getDocusaurusConfig(workspaceId);
      if (!config || !config.enabled) {
        throw new BadRequestException('Docusaurus integration is not enabled');
      }

      const validation = await this.validateDocusaurusSetup(workspaceId);
      if (!validation.valid) {
        throw new BadRequestException(`Docusaurus setup is invalid: ${validation.errors.join(', ')}`);
      }

      if (contentType === 'page') {
        return await this.exportPageToDocusaurus(workspaceId, contentId, config, options);
      } else {
        return await this.exportSpaceToDocusaurus(workspaceId, contentId, config, options);
      }
    } catch (error) {
      this.logger.error(`Failed to export ${contentType} ${contentId} to Docusaurus`, error);
      return {
        success: false,
        message: (error as Error)?.message || 'Export failed',
      };
    }
  }

  private async exportPageToDocusaurus(
    workspaceId: string,
    pageId: string,
    config: DocusaurusConfig,
    options: { includeChildren?: boolean }
  ): Promise<{ success: boolean; message: string; filePath?: string }> {
    const page = await this.pageRepo.findById(pageId, { includeContent: true });
    if (!page) {
      throw new BadRequestException('Page not found');
    }

    // Find space mapping for this page's space
    const spaceMapping = config.spaceMappings.find(m => m.spaceId === page.spaceId);
    if (!spaceMapping) {
      throw new BadRequestException(`No Docusaurus mapping found for space ${page.spaceId}`);
    }

    // Get space info
    const space = await this.db
      .selectFrom('spaces')
      .selectAll()
      .where('id', '=', page.spaceId)
      .executeTakeFirst();

    if (!space) {
      throw new BadRequestException('Space not found');
    }

    // Create category directory and metadata
    const categoryPath = this.sanitizeFilename(spaceMapping.categoryName);
    await this.ensureDocsDirectory(config.sitePath, categoryPath);
    
    const categoryMetadata = await this.createCategoryMetadata(spaceMapping, space.name);
    await this.writeDocusaurusCategoryFile(config.sitePath, categoryPath, categoryMetadata);

    let exportedCount = 1;
    let finalFilePath: string;

    if (options.includeChildren) {
      // Get all pages in the space to build hierarchy for this page
      const allSpacePages = await this.db
        .selectFrom('pages')
        .select([
          'pages.id',
          'pages.slugId',
          'pages.title',
          'pages.content',
          'pages.parentPageId',
          'pages.spaceId',
          'pages.workspaceId',
        ])
        .where('spaceId', '=', page.spaceId)
        .execute();

      // Build the hierarchy path for this page
      const hierarchyPath = await this.buildPageHierarchyPath(page, allSpacePages);
      
      // Export this page and all its children hierarchically
      const exportedPages = new Set<string>();
      exportedCount = await this.exportPageWithHierarchy(
        config.sitePath,
        categoryPath,
        allSpacePages,
        page,
        hierarchyPath,
        exportedPages
      );

      finalFilePath = path.join(categoryPath, hierarchyPath, this.sanitizeFilename(page.title || 'untitled') + '.md');
    } else {
      // Export just this page
      const pageContent = await this.exportService.exportPage(ExportFormat.Docusaurus, page, true);
      
      // Build the hierarchy path for proper placement
      const allSpacePages = await this.db
        .selectFrom('pages')
        .select(['id', 'title', 'parentPageId'])
        .where('spaceId', '=', page.spaceId)
        .execute();
      
      const hierarchyPath = await this.buildPageHierarchyPath(page, allSpacePages);
      const fullPath = path.join(config.sitePath, 'docs', categoryPath, hierarchyPath);
      
      // Ensure the directory exists
      await this.ensureDirectory(fullPath);
      
      // Generate filename and write file
      const filename = this.sanitizeFilename(page.title || 'untitled') + '.md';
      const filePath = path.join(fullPath, filename);
      await writeFile(filePath, pageContent);
      
      finalFilePath = path.join(categoryPath, hierarchyPath, filename);
    }

    this.logger.log(`Exported page "${page.title}" with hierarchy to Docusaurus`);

    return {
      success: true,
      message: `Page exported successfully: ${exportedCount} pages exported to ${finalFilePath}`,
      filePath: finalFilePath,
    };
  }

  private async exportSpaceToDocusaurus(
    workspaceId: string,
    spaceId: string,
    config: DocusaurusConfig,
    options: { includeAttachments?: boolean }
  ): Promise<{ success: boolean; message: string; filePath?: string }> {
    // Find space mapping
    const spaceMapping = config.spaceMappings.find(m => m.spaceId === spaceId);
    if (!spaceMapping) {
      throw new BadRequestException(`No Docusaurus mapping found for space ${spaceId}`);
    }

    // Get space info
    const space = await this.db
      .selectFrom('spaces')
      .selectAll()
      .where('id', '=', spaceId)
      .executeTakeFirst();

    if (!space) {
      throw new BadRequestException('Space not found');
    }

    // Get all pages in the space
    const pages = await this.db
      .selectFrom('pages')
      .select([
        'pages.id',
        'pages.slugId',
        'pages.title',
        'pages.content',
        'pages.parentPageId',
        'pages.spaceId',
        'pages.workspaceId',
      ])
      .where('spaceId', '=', spaceId)
      .execute();

    // Create category directory and metadata
    const categoryPath = this.sanitizeFilename(spaceMapping.categoryName);
    await this.ensureDocsDirectory(config.sitePath, categoryPath);
    
    const categoryMetadata = await this.createCategoryMetadata(spaceMapping, space.name);
    await this.writeDocusaurusCategoryFile(config.sitePath, categoryPath, categoryMetadata);

    // Build page hierarchy and export hierarchically with cross-reference support
    const exportedPages = new Set<string>();
    const exportedCount = await this.exportPagesHierarchically(
      config.sitePath,
      categoryPath,
      pages,
      null, // Start with root pages (no parent)
      '',   // Start at category root
      exportedPages,
      []    // Empty processing path to start
    );

    this.logger.log(`Exported ${exportedCount} pages from space "${space.name}" to Docusaurus with hierarchy`);

    return {
      success: true,
      message: `Space exported successfully: ${exportedCount} pages exported to ${categoryPath} with hierarchical organization`,
      filePath: categoryPath,
    };
  }

  private async exportPagesHierarchically(
    sitePath: string,
    categoryPath: string,
    allPages: any[],
    parentPageId: string | null,
    currentPath: string,
    exportedPages: Set<string> = new Set(),
    processingPath: string[] = []
  ): Promise<number> {
    let exportedCount = 0;
    
    // Find pages that are children of the current parent
    const childPages = allPages.filter(page => page.parentPageId === parentPageId);
    
    for (const page of childPages) {
      try {
        // Check for circular references
        if (processingPath.includes(page.id)) {
          this.logger.warn(`Circular reference detected for page "${page.title}" (${page.id}). Skipping to prevent infinite loop.`);
          continue;
        }

        // Check if already exported (handles cross-references)
        if (exportedPages.has(page.id)) {
          this.logger.log(`Page "${page.title}" already exported, creating cross-reference`);
          await this.createCrossReference(sitePath, categoryPath, page, currentPath, allPages);
          continue;
        }

        // Add to processing path for circular reference detection
        const newProcessingPath = [...processingPath, page.id];
        
        // Determine the file path for this page
        let pagePath = currentPath;
        let filename = this.sanitizeFilename(page.title || 'untitled') + '.md';
        
        // Check if this page has children - if so, create a directory for it
        const hasChildren = allPages.some(p => p.parentPageId === page.id);
        
        if (hasChildren) {
          // Create a directory for this page and its children
          const pageDir = this.sanitizeFilename(page.title || 'untitled');
          pagePath = currentPath ? path.join(currentPath, pageDir) : pageDir;
          
          // Create the directory
          const fullDirPath = path.join(sitePath, 'docs', categoryPath, pagePath);
          await this.ensureDirectory(fullDirPath);
          
          // The main page goes in the directory as index.md or the page name
          filename = 'index.md';
        }
        
        // Export the page content with cross-reference processing
        const pageContent = await this.exportService.exportPage(ExportFormat.Docusaurus, page as any, true);
        const processedContent = await this.processContentReferences(
          pageContent, 
          page, 
          allPages, 
          categoryPath, 
          pagePath
        );
        
        // Write the file
        const fullFilePath = path.join(sitePath, 'docs', categoryPath, pagePath, filename);
        await writeFile(fullFilePath, processedContent);
        exportedPages.add(page.id);
        exportedCount++;
        
        this.logger.log(`Exported page "${page.title}" to ${path.join(categoryPath, pagePath, filename)}`);
        
        // Recursively export children if they exist
        if (hasChildren) {
          const childrenExported = await this.exportPagesHierarchically(
            sitePath,
            categoryPath,
            allPages,
            page.id,
            pagePath,
            exportedPages,
            newProcessingPath
          );
          exportedCount += childrenExported;
        }
        
      } catch (error) {
        this.logger.warn(`Failed to export page "${page.title}": ${(error as Error)?.message}`);
      }
    }
    
    return exportedCount;
  }

  private async ensureDirectory(dirPath: string): Promise<void> {
    try {
      await access(dirPath);
    } catch {
      await mkdir(dirPath, { recursive: true });
      this.logger.log(`Created directory: ${dirPath}`);
    }
  }

  private async createCrossReference(
    sitePath: string,
    categoryPath: string,
    page: any,
    currentPath: string,
    allPages: any[]
  ): Promise<void> {
    // Create a redirect or reference file that points to the main location
    const originalPath = await this.findPageExportPath(page, allPages, categoryPath);
    const redirectFilename = this.sanitizeFilename(page.title || 'untitled') + '-ref.md';
    const redirectFilePath = path.join(sitePath, 'docs', categoryPath, currentPath, redirectFilename);
    
    // Create a simple redirect file
    const redirectContent = `---
title: ${page.title || 'Untitled'}
description: Cross-reference to ${page.title || 'Untitled'}
---

# ${page.title || 'Untitled'}

This page has been moved. Please refer to the main content at:

[📖 View the main content](${originalPath})

---

*This is a cross-reference generated automatically during export.*
`;

    await this.ensureDirectory(path.dirname(redirectFilePath));
    await writeFile(redirectFilePath, redirectContent);
    
    this.logger.log(`Created cross-reference for "${page.title}" at ${redirectFilename}`);
  }

  private async findPageExportPath(page: any, allPages: any[], categoryPath: string): Promise<string> {
    // Build the path where this page was originally exported
    const hierarchyPath = await this.buildPageHierarchyPath(page, allPages);
    const hasChildren = allPages.some(p => p.parentPageId === page.id);
    
    if (hasChildren) {
      const pageDir = this.sanitizeFilename(page.title || 'untitled');
      const fullPath = hierarchyPath ? path.join(hierarchyPath, pageDir) : pageDir;
      return `/${categoryPath}/${fullPath}/`;
    } else {
      const filename = this.sanitizeFilename(page.title || 'untitled');
      return hierarchyPath ? 
        `/${categoryPath}/${hierarchyPath}/${filename}` : 
        `/${categoryPath}/${filename}`;
    }
  }

  private async processContentReferences(
    content: string,
    currentPage: any,
    allPages: any[],
    categoryPath: string,
    pagePath: string
  ): Promise<string> {
    let processedContent = content;
    
    // Find references in the content and update them to proper Docusaurus links
    const references = this.findContentReferences(currentPage.content || '{}', allPages);
    
    for (const refPageId of references) {
      const referencedPage = allPages.find(p => p.id === refPageId);
      if (referencedPage) {
        const refPath = await this.findPageExportPath(referencedPage, allPages, categoryPath);
        const refTitle = referencedPage.title || 'Untitled';
        
        // Replace page title mentions with proper Docusaurus links
        const titleRegex = new RegExp(`\\b${this.escapeRegExp(refTitle)}\\b`, 'gi');
        const linkReplacement = `[${refTitle}](${refPath})`;
        
        // Only replace if it's not already a link
        processedContent = processedContent.replace(titleRegex, (match, offset) => {
          // Check if this text is already part of a markdown link
          const beforeMatch = processedContent.substring(Math.max(0, offset - 10), offset);
          const afterMatch = processedContent.substring(offset + match.length, offset + match.length + 10);
          
          if (beforeMatch.includes('[') && afterMatch.includes('](') || 
              beforeMatch.includes('](') || 
              afterMatch.includes(')')) {
            return match; // Already a link, don't replace
          }
          
          return linkReplacement;
        });
      }
    }
    
    return processedContent;
  }

  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  private async buildPageHierarchyPath(page: any, allPages: any[]): Promise<string> {
    const pathSegments: string[] = [];
    let currentPage = page;

    // Walk up the hierarchy to build the path
    while (currentPage && currentPage.parentPageId) {
      const parent = allPages.find(p => p.id === currentPage.parentPageId);
      if (parent) {
        pathSegments.unshift(this.sanitizeFilename(parent.title || 'untitled'));
        currentPage = parent;
      } else {
        break; // No parent found, exit loop
      }
    }

    return pathSegments.join('/');
  }

  private async exportPageWithHierarchy(
    sitePath: string,
    categoryPath: string,
    allPages: any[],
    rootPage: any,
    basePath: string,
    exportedPages: Set<string> = new Set()
  ): Promise<number> {
    let exportedCount = 0;

    // Check if already exported
    if (exportedPages.has(rootPage.id)) {
      this.logger.log(`Page "${rootPage.title}" already exported, skipping duplicate`);
      return 0;
    }

    // Export the root page
    try {
      const pageContent = await this.exportService.exportPage(ExportFormat.Docusaurus, rootPage, true);
      const processedContent = await this.processContentReferences(
        pageContent, 
        rootPage, 
        allPages, 
        categoryPath, 
        basePath
      );
      
      // Check if this page has children
      const hasChildren = allPages.some(p => p.parentPageId === rootPage.id);
      
      let filename: string;
      let fullPath: string;
      
      if (hasChildren) {
        // Create a directory for this page and place it as index.md
        const pageDir = this.sanitizeFilename(rootPage.title || 'untitled');
        const hierarchyPath = basePath ? path.join(basePath, pageDir) : pageDir;
        fullPath = path.join(sitePath, 'docs', categoryPath, hierarchyPath);
        await this.ensureDirectory(fullPath);
        filename = 'index.md';
      } else {
        // Place it directly in the current path
        fullPath = path.join(sitePath, 'docs', categoryPath, basePath);
        await this.ensureDirectory(fullPath);
        filename = this.sanitizeFilename(rootPage.title || 'untitled') + '.md';
      }
      
      const filePath = path.join(fullPath, filename);
      await writeFile(filePath, processedContent);
      exportedPages.add(rootPage.id);
      exportedCount++;
      
      // Recursively export children if they exist
      if (hasChildren) {
        const pageDir = this.sanitizeFilename(rootPage.title || 'untitled');
        const childPath = basePath ? path.join(basePath, pageDir) : pageDir;
        
        const childrenExported = await this.exportPagesHierarchically(
          sitePath,
          categoryPath,
          allPages,
          rootPage.id,
          childPath,
          exportedPages,
          [rootPage.id] // Start processing path with current page
        );
        exportedCount += childrenExported;
      }
      
    } catch (error) {
      this.logger.warn(`Failed to export page "${rootPage.title}": ${(error as Error)?.message}`);
    }

    return exportedCount;
  }

  private sanitizeFilename(filename: string): string {
    return filename
      .replace(/[^\w\s-]/g, '') // Remove special characters except spaces and hyphens
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .toLowerCase()
      .trim();
  }

  // Phase 3: Intelligent Categorization Logic

  async analyzeContentHierarchy(workspaceId: string): Promise<{
    suggestions: CategorySuggestion[];
    hierarchy: ContentHierarchy;
    stats: ContentAnalysisStats;
  }> {
    const spaces = await this.db
      .selectFrom('spaces')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .execute();

    const allPages = await this.db
      .selectFrom('pages')
      .select([
        'pages.id',
        'pages.title',
        'pages.content',
        'pages.parentPageId',
        'pages.spaceId',
        'pages.createdAt',
        'pages.updatedAt',
      ])
      .where('pages.workspaceId', '=', workspaceId)
      .execute();

    // Analyze content patterns and relationships
    const contentAnalysis = this.performContentAnalysis(allPages);
    
    // Generate category suggestions based on analysis
    const suggestions = this.generateCategorySuggestions(spaces, allPages, contentAnalysis);
    
    // Build hierarchical structure
    const hierarchy = this.buildContentHierarchy(spaces, allPages);
    
    // Generate statistics
    const stats = this.generateContentStats(spaces, allPages, contentAnalysis);

    return { suggestions, hierarchy, stats };
  }

  private performContentAnalysis(pages: any[]): ContentAnalysis {
    const keywords: Map<string, number> = new Map();
    const pageTags: Map<string, string[]> = new Map();
    const relationships: PageRelationship[] = [];

    for (const page of pages) {
      // Extract keywords from title and content
      const pageKeywords = this.extractKeywords(page.title, page.content);
      pageKeywords.forEach(keyword => {
        keywords.set(keyword, (keywords.get(keyword) || 0) + 1);
      });
      
      // Store page tags for clustering
      pageTags.set(page.id, pageKeywords);
      
      // Analyze relationships
      if (page.parentPageId) {
        relationships.push({
          parentId: page.parentPageId,
          childId: page.id,
          type: 'hierarchical',
        });
      }
      
      // Find content references (basic implementation)
      const contentRefs = this.findContentReferences(page.content, pages);
      contentRefs.forEach(refId => {
        relationships.push({
          parentId: page.id,
          childId: refId,
          type: 'reference',
        });
      });
    }

    return {
      keywords: Array.from(keywords.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 50), // Top 50 keywords
      pageTags,
      relationships,
      clusters: this.clusterContent(pageTags),
    };
  }

  private extractKeywords(title: string, content: string): string[] {
    const text = `${title} ${this.extractTextFromContent(content)}`.toLowerCase();
    
    // Common stop words to filter out
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my', 'your', 'his', 'her', 'its', 'our', 'their'
    ]);
    
    return text
      .split(/\W+/)
      .filter(word => word.length > 2 && !stopWords.has(word))
      .slice(0, 20); // Top 20 keywords per page
  }

  private extractTextFromContent(content: string): string {
    try {
      // Basic extraction from JSON content (ProseMirror format)
      const contentObj = JSON.parse(content);
      return this.extractTextFromNode(contentObj);
    } catch {
      return '';
    }
  }

  private extractTextFromNode(node: any): string {
    if (!node) return '';
    
    let text = '';
    
    if (node.text) {
      text += node.text + ' ';
    }
    
    if (node.content && Array.isArray(node.content)) {
      for (const child of node.content) {
        text += this.extractTextFromNode(child);
      }
    }
    
    return text;
  }

  private findContentReferences(content: string, allPages: any[]): string[] {
    const references: string[] = [];
    
    try {
      // Parse JSON content to look for specific link structures
      const contentObj = JSON.parse(content);
      this.extractReferencesFromNode(contentObj, allPages, references);
    } catch {
      // Fallback to basic text matching
      allPages.forEach(page => {
        if (page.title && typeof content === 'string' && content.toLowerCase().includes(page.title.toLowerCase())) {
          references.push(page.id);
        }
      });
    }
    
    return [...new Set(references)]; // Remove duplicates
  }

  private extractReferencesFromNode(node: any, allPages: any[], references: string[]): void {
    if (!node) return;

    // Check for internal links (assuming ProseMirror link structure)
    if (node.type === 'link' && node.attrs?.href) {
      const href = node.attrs.href;
      
      // Look for internal page references
      const referencedPage = allPages.find(page => 
        href.includes(page.id) || href.includes(page.slugId) || 
        (page.title && href.toLowerCase().includes(page.title.toLowerCase().replace(/\s+/g, '-')))
      );
      
      if (referencedPage) {
        references.push(referencedPage.id);
      }
    }

    // Check for mention nodes (if using mention extension)
    if (node.type === 'mention' && node.attrs?.id) {
      const mentionId = node.attrs.id;
      const mentionedPage = allPages.find(page => page.id === mentionId);
      if (mentionedPage) {
        references.push(mentionedPage.id);
      }
    }

    // Check text content for page title references
    if (node.text) {
      allPages.forEach(page => {
        if (page.title && node.text.toLowerCase().includes(page.title.toLowerCase())) {
          references.push(page.id);
        }
      });
    }

    // Recursively check child nodes
    if (node.content && Array.isArray(node.content)) {
      for (const child of node.content) {
        this.extractReferencesFromNode(child, allPages, references);
      }
    }
  }

  private clusterContent(pageTags: Map<string, string[]>): ContentCluster[] {
    const clusters: ContentCluster[] = [];
    const pageIds = Array.from(pageTags.keys());
    const processed = new Set<string>();
    
    for (const pageId of pageIds) {
      if (processed.has(pageId)) continue;
      
      const pageTags1 = pageTags.get(pageId) || [];
      const cluster: ContentCluster = {
        id: `cluster_${clusters.length}`,
        pages: [pageId],
        commonTags: [...pageTags1],
        similarity: 1.0,
      };
      
      // Find similar pages
      for (const otherPageId of pageIds) {
        if (pageId === otherPageId || processed.has(otherPageId)) continue;
        
        const pageTags2 = pageTags.get(otherPageId) || [];
        const similarity = this.calculateSimilarity(pageTags1, pageTags2);
        
        if (similarity > 0.3) { // 30% similarity threshold
          cluster.pages.push(otherPageId);
          cluster.commonTags = this.findCommonTags(cluster.commonTags, pageTags2);
          processed.add(otherPageId);
        }
      }
      
      processed.add(pageId);
      
      if (cluster.pages.length > 1) {
        clusters.push(cluster);
      }
    }
    
    return clusters;
  }

  private calculateSimilarity(tags1: string[], tags2: string[]): number {
    const set1 = new Set(tags1);
    const set2 = new Set(tags2);
    const intersection = new Set([...set1].filter(tag => set2.has(tag)));
    const union = new Set([...set1, ...set2]);
    
    return union.size > 0 ? intersection.size / union.size : 0;
  }

  private findCommonTags(tags1: string[], tags2: string[]): string[] {
    const set1 = new Set(tags1);
    return tags2.filter(tag => set1.has(tag));
  }

  private generateCategorySuggestions(
    spaces: any[],
    pages: any[],
    analysis: ContentAnalysis,
  ): CategorySuggestion[] {
    const suggestions: CategorySuggestion[] = [];
    
    // Suggest categories based on content clusters
    analysis.clusters.forEach((cluster, index) => {
      if (cluster.pages.length >= 3 && cluster.commonTags.length > 0) {
        const categoryName = this.generateCategoryName(cluster.commonTags);
        const spaceIds = [...new Set(cluster.pages.map(pageId => {
          const page = pages.find(p => p.id === pageId);
          return page?.spaceId;
        }).filter(Boolean))];
        
        suggestions.push({
          type: 'content-cluster',
          categoryName,
          suggestedSpaces: spaceIds,
          confidence: Math.min(0.9, cluster.commonTags.length * 0.2),
          reasoning: `Based on ${cluster.pages.length} pages with common topics: ${cluster.commonTags.slice(0, 3).join(', ')}`,
          pages: cluster.pages,
        });
      }
    });
    
    // Suggest categories based on space names and content
    spaces.forEach(space => {
      const spacePages = pages.filter(p => p.spaceId === space.id);
      if (spacePages.length > 0) {
        const keywords = analysis.keywords
          .filter(([keyword]) => spacePages.some(page => 
            page.title.toLowerCase().includes(keyword) || 
            this.extractTextFromContent(page.content).toLowerCase().includes(keyword)
          ))
          .slice(0, 5);
        
        if (keywords.length > 0) {
          suggestions.push({
            type: 'space-based',
            categoryName: this.generateCategoryName([space.name, ...keywords.map(k => k[0])]),
            suggestedSpaces: [space.id],
            confidence: 0.8,
            reasoning: `Based on space "${space.name}" with ${spacePages.length} pages`,
            pages: spacePages.map(p => p.id),
          });
        }
      }
    });
    
    return suggestions.sort((a, b) => b.confidence - a.confidence);
  }

  private generateCategoryName(tags: string[]): string {
    // Take the most relevant tags and create a meaningful category name
    const relevantTags = tags.slice(0, 3);
    
    if (relevantTags.length === 0) return 'General';
    if (relevantTags.length === 1) return this.capitalize(relevantTags[0]);
    
    // Try to create a meaningful combination
    const mainTag = this.capitalize(relevantTags[0]);
    const secondaryTags = relevantTags.slice(1).map(tag => this.capitalize(tag));
    
    // Common patterns for category naming
    if (relevantTags.some(tag => tag.includes('api'))) {
      return `${mainTag} API`;
    }
    if (relevantTags.some(tag => tag.includes('guide'))) {
      return `${mainTag} Guides`;
    }
    if (relevantTags.some(tag => tag.includes('tutorial'))) {
      return `${mainTag} Tutorials`;
    }
    
    return `${mainTag} & ${secondaryTags.join(' & ')}`;
  }

  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  private buildContentHierarchy(spaces: any[], pages: any[]): ContentHierarchy {
    const hierarchy: ContentHierarchy = {
      spaces: [],
      totalPages: pages.length,
      maxDepth: 0,
    };
    
    spaces.forEach(space => {
      const spacePages = pages.filter(p => p.spaceId === space.id);
      const rootPages = spacePages.filter(p => !p.parentPageId);
      
      const spaceHierarchy: SpaceHierarchy = {
        spaceId: space.id,
        spaceName: space.name,
        totalPages: spacePages.length,
        rootPages: rootPages.map(page => this.buildPageHierarchy(page, spacePages)),
        depth: this.calculateSpaceDepth(spacePages),
      };
      
      hierarchy.maxDepth = Math.max(hierarchy.maxDepth, spaceHierarchy.depth);
      hierarchy.spaces.push(spaceHierarchy);
    });
    
    return hierarchy;
  }

  private buildPageHierarchy(page: any, allSpacePages: any[]): PageHierarchy {
    const children = allSpacePages
      .filter(p => p.parentPageId === page.id)
      .map(child => this.buildPageHierarchy(child, allSpacePages));
    
    return {
      pageId: page.id,
      title: page.title,
      children,
      depth: children.length > 0 ? Math.max(...children.map(c => c.depth)) + 1 : 1,
    };
  }

  private calculateSpaceDepth(spacePages: any[]): number {
    const rootPages = spacePages.filter(p => !p.parentPageId);
    if (rootPages.length === 0) return 0;
    
    return Math.max(...rootPages.map(page => 
      this.buildPageHierarchy(page, spacePages).depth
    ));
  }

  private generateContentStats(
    spaces: any[],
    pages: any[],
    analysis: ContentAnalysis,
  ): ContentAnalysisStats {
    return {
      totalSpaces: spaces.length,
      totalPages: pages.length,
      averagePagesPerSpace: Math.round(pages.length / spaces.length),
      topKeywords: analysis.keywords.slice(0, 10),
      totalClusters: analysis.clusters.length,
      averageClusterSize: Math.round(
        analysis.clusters.reduce((sum, cluster) => sum + cluster.pages.length, 0) / 
        Math.max(analysis.clusters.length, 1)
      ),
      hierarchicalPages: pages.filter(p => p.parentPageId).length,
      orphanPages: pages.filter(p => !p.parentPageId && 
        !pages.some(other => other.parentPageId === p.id)
      ).length,
    };
  }

  // API endpoint method
  async suggestCategories(workspaceId: string): Promise<{
    suggestions: CategorySuggestion[];
    hierarchy: ContentHierarchy;
    stats: ContentAnalysisStats;
  }> {
    return await this.analyzeContentHierarchy(workspaceId);
  }

  // Phase 4: Automated Sync Service

  async performAutomatedSync(workspaceId: string, options: { incremental?: boolean } = {}): Promise<SyncResult> {
    const syncId = this.generateSyncId();
    const syncStart = new Date();
    
    try {
      this.logger.log(`Starting ${options.incremental ? 'incremental' : 'full'} sync for workspace ${workspaceId} (sync: ${syncId})`);
      
      // Get current configuration
      const config = await this.getDocusaurusConfig(workspaceId);
      if (!config || !config.enabled) {
        throw new Error('Docusaurus integration is not enabled');
      }

      // Validate setup before sync
      const validation = await this.validateDocusaurusSetup(workspaceId);
      if (!validation.valid) {
        throw new Error(`Setup validation failed: ${validation.errors.join(', ')}`);
      }

      // Get all spaces that have mappings
      const spaceMappings = config.spaceMappings || [];
      if (spaceMappings.length === 0) {
        throw new Error('No space mappings configured');
      }

      const syncStats: SyncStats = {
        totalSpaces: spaceMappings.length,
        successfulSpaces: 0,
        failedSpaces: 0,
        totalPages: 0,
        successfulPages: 0,
        failedPages: 0,
        conflicts: [],
        errors: [],
      };

      // Get last sync timestamp for incremental sync
      const lastSyncTime = options.incremental ? await this.getLastSyncTimestamp(workspaceId) : null;
      if (options.incremental && lastSyncTime) {
        this.logger.log(`Performing incremental sync since ${lastSyncTime.toISOString()}`);
      }

      // Sync each mapped space
      for (const mapping of spaceMappings) {
        try {
          this.logger.log(`Syncing space ${mapping.spaceId} -> ${mapping.categoryName}`);
          
          let spacePagesToSync: number;
          let spaceResult: { success: boolean; message: string; filePath?: string };

          if (options.incremental && lastSyncTime) {
            // Check if space has changes since last sync
            const hasChanges = await this.hasSpaceChangedSince(mapping.spaceId, lastSyncTime);
            if (!hasChanges) {
              this.logger.log(`Space ${mapping.spaceId} has no changes since last sync, skipping`);
              syncStats.successfulSpaces++;
              spacePagesToSync = await this.getSpacePageCount(mapping.spaceId);
              syncStats.totalPages += spacePagesToSync;
              syncStats.successfulPages += spacePagesToSync;
              continue;
            }

            // Get only changed pages for incremental sync
            const changedPages = await this.getChangedPagesInSpace(mapping.spaceId, lastSyncTime);
            spacePagesToSync = changedPages.length;
            this.logger.log(`Found ${spacePagesToSync} changed pages in space ${mapping.spaceId}`);

            if (spacePagesToSync === 0) {
              syncStats.successfulSpaces++;
              continue;
            }

            // Export only changed pages
            spaceResult = await this.exportChangedPagesToDocusaurus(
              workspaceId,
              mapping.spaceId,
              changedPages,
              { includeChildren: true, includeAttachments: false }
            );
          } else {
            // Full space export
            spaceResult = await this.exportContentToDocusaurus(
              workspaceId,
              mapping.spaceId,
              'space',
              { includeChildren: true, includeAttachments: false }
            );
            spacePagesToSync = await this.getSpacePageCount(mapping.spaceId);
          }

          if (spaceResult.success) {
            syncStats.successfulSpaces++;
            syncStats.totalPages += spacePagesToSync;
            syncStats.successfulPages += spacePagesToSync;
          } else {
            syncStats.failedSpaces++;
            syncStats.errors.push(`Space ${mapping.spaceId}: ${spaceResult.message}`);
          }
        } catch (error) {
          syncStats.failedSpaces++;
          syncStats.errors.push(`Space ${mapping.spaceId}: ${(error as Error)?.message}`);
          this.logger.error(`Failed to sync space ${mapping.spaceId}:`, error);
        }
      }

      const syncEnd = new Date();
      const duration = syncEnd.getTime() - syncStart.getTime();

      const syncResult: SyncResult = {
        syncId,
        workspaceId,
        status: syncStats.failedSpaces === 0 ? 'success' : (syncStats.successfulSpaces > 0 ? 'partial' : 'failed'),
        startTime: syncStart,
        endTime: syncEnd,
        duration,
        stats: syncStats,
        configSnapshot: {
          spaceMappings: spaceMappings.length,
          autoSyncEnabled: config.autoSync?.enabled || false,
          autoSyncInterval: config.autoSync?.interval || 'manual',
        },
      };

      // Store sync result for history
      await this.storeSyncResult(syncResult);

      this.logger.log(`Automated sync completed for workspace ${workspaceId} (sync: ${syncId}) - Status: ${syncResult.status}`);
      
      return syncResult;
    } catch (error) {
      const syncEnd = new Date();
      const duration = syncEnd.getTime() - syncStart.getTime();

      const failedResult: SyncResult = {
        syncId,
        workspaceId,
        status: 'failed',
        startTime: syncStart,
        endTime: syncEnd,
        duration,
        stats: {
          totalSpaces: 0,
          successfulSpaces: 0,
          failedSpaces: 0,
          totalPages: 0,
          successfulPages: 0,
          failedPages: 0,
          conflicts: [],
          errors: [(error as Error)?.message || 'Unknown error'],
        },
        configSnapshot: { spaceMappings: 0, autoSyncEnabled: false, autoSyncInterval: 'manual' },
      };

      await this.storeSyncResult(failedResult);
      
      this.logger.error(`Automated sync failed for workspace ${workspaceId} (sync: ${syncId}):`, error);
      
      return failedResult;
    }
  }

  async triggerManualSync(workspaceId: string): Promise<SyncResult> {
    this.logger.log(`Manual sync triggered for workspace ${workspaceId}`);
    return await this.performAutomatedSync(workspaceId);
  }

  async getSyncHistory(workspaceId: string, limit = 10): Promise<SyncResult[]> {
    try {
      const workspace = await this.workspaceService.findById(workspaceId);
      const settings = (workspace?.settings as any) || {};
      const syncHistory = settings.docusaurusSyncHistory || [];
      
      return syncHistory
        .sort((a: SyncResult, b: SyncResult) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
        .slice(0, limit);
    } catch (error) {
      this.logger.error(`Failed to get sync history for workspace ${workspaceId}:`, error);
      return [];
    }
  }

  async getLastSyncStatus(workspaceId: string): Promise<SyncResult | null> {
    const history = await this.getSyncHistory(workspaceId, 1);
    return history.length > 0 ? history[0] : null;
  }

  private generateSyncId(): string {
    return `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  private async getSpacePageCount(spaceId: string): Promise<number> {
    try {
      const pages = await this.db
        .selectFrom('pages')
        .select(['id'])
        .where('spaceId', '=', spaceId)
        .execute();
      
      return pages.length;
    } catch (error) {
      this.logger.error(`Failed to get page count for space ${spaceId}:`, error);
      return 0;
    }
  }

  private async storeSyncResult(syncResult: SyncResult): Promise<void> {
    try {
      const workspace = await this.workspaceService.findById(syncResult.workspaceId);
      const currentSettings = (workspace?.settings as any) || {};
      const syncHistory = currentSettings.docusaurusSyncHistory || [];
      
      // Add new sync result and keep only last 50 results
      syncHistory.unshift(syncResult);
      const trimmedHistory = syncHistory.slice(0, 50);
      
      const updatedSettings = {
        ...currentSettings,
        docusaurusSyncHistory: trimmedHistory,
        lastSyncResult: syncResult,
      };

      await this.workspaceService.update(syncResult.workspaceId, {
        settings: updatedSettings,
      });
      
      this.logger.log(`Stored sync result ${syncResult.syncId} for workspace ${syncResult.workspaceId}`);
    } catch (error) {
      this.logger.error(`Failed to store sync result ${syncResult.syncId}:`, error);
    }
  }

  // Automated Sync Scheduler Methods

  private async initializeScheduledSyncs(): Promise<void> {
    try {
      this.logger.log('Initializing scheduled sync jobs...');
      
      // Get all workspaces with auto-sync enabled
      const workspaces = await this.db
        .selectFrom('workspaces')
        .selectAll()
        .execute();

      for (const workspace of workspaces) {
        const config = await this.getDocusaurusConfig(workspace.id);
        if (config?.enabled && config?.autoSync?.enabled) {
          await this.scheduleWorkspaceSync(workspace.id, config.autoSync.interval);
        }
      }
      
      this.logger.log('Scheduled sync jobs initialized');
    } catch (error) {
      this.logger.error('Failed to initialize scheduled sync jobs:', error);
    }
  }

  async scheduleWorkspaceSync(workspaceId: string, interval: DocusaurusSyncInterval): Promise<void> {
    const jobName = `docusaurus-sync-${workspaceId}`;
    
    // Remove existing job if it exists
    await this.unscheduleWorkspaceSync(workspaceId);
    
    if (interval === DocusaurusSyncInterval.MANUAL) {
      this.logger.log(`Workspace ${workspaceId} set to manual sync only`);
      return;
    }
    
    let cronPattern: string;
    switch (interval) {
      case DocusaurusSyncInterval.HOURLY:
        cronPattern = '0 * * * *'; // Every hour at minute 0
        break;
      case DocusaurusSyncInterval.DAILY:
        cronPattern = '0 2 * * *'; // Daily at 2 AM
        break;
      default:
        this.logger.warn(`Unknown sync interval: ${interval} for workspace ${workspaceId}`);
        return;
    }
    
    try {
      const job = new CronJob(cronPattern, async () => {
        this.logger.log(`Executing scheduled incremental sync for workspace ${workspaceId} (${interval})`);
        try {
          await this.performAutomatedSync(workspaceId, { incremental: true });
        } catch (error) {
          this.logger.error(`Scheduled sync failed for workspace ${workspaceId}:`, error);
        }
      });
      
      this.schedulerRegistry.addCronJob(jobName, job);
      job.start();
      
      this.logger.log(`Scheduled ${interval} sync for workspace ${workspaceId} with pattern: ${cronPattern}`);
    } catch (error) {
      this.logger.error(`Failed to schedule sync for workspace ${workspaceId}:`, error);
    }
  }

  async unscheduleWorkspaceSync(workspaceId: string): Promise<void> {
    const jobName = `docusaurus-sync-${workspaceId}`;
    
    try {
      if (this.schedulerRegistry.getCronJob(jobName)) {
        this.schedulerRegistry.deleteCronJob(jobName);
        this.logger.log(`Unscheduled sync job for workspace ${workspaceId}`);
      }
    } catch (error) {
      // Job doesn't exist, which is fine
      this.logger.debug(`No existing sync job found for workspace ${workspaceId}`);
    }
  }

  async updateScheduledSync(workspaceId: string, config: DocusaurusConfig): Promise<void> {
    if (!config.enabled || !config.autoSync?.enabled) {
      // Auto-sync is disabled, remove any existing scheduled job
      await this.unscheduleWorkspaceSync(workspaceId);
      this.logger.log(`Auto-sync disabled for workspace ${workspaceId}, removed scheduled job`);
    } else {
      // Auto-sync is enabled, schedule or reschedule the job
      await this.scheduleWorkspaceSync(workspaceId, config.autoSync.interval);
    }
  }

  // Incremental Sync Helper Methods

  private async getLastSyncTimestamp(workspaceId: string): Promise<Date | null> {
    try {
      const lastSync = await this.getLastSyncStatus(workspaceId);
      return lastSync ? new Date(lastSync.endTime) : null;
    } catch (error) {
      this.logger.error(`Failed to get last sync timestamp for workspace ${workspaceId}:`, error);
      return null;
    }
  }

  private async hasSpaceChangedSince(spaceId: string, sinceDate: Date): Promise<boolean> {
    try {
      const recentChanges = await this.db
        .selectFrom('pages')
        .select(['id'])
        .where('spaceId', '=', spaceId)
        .where('updatedAt', '>', sinceDate)
        .limit(1)
        .execute();

      return recentChanges.length > 0;
    } catch (error) {
      this.logger.error(`Failed to check changes for space ${spaceId}:`, error);
      return true; // Default to true to ensure sync happens
    }
  }

  private async getChangedPagesInSpace(spaceId: string, sinceDate: Date): Promise<any[]> {
    try {
      const changedPages = await this.db
        .selectFrom('pages')
        .select([
          'pages.id',
          'pages.slugId',
          'pages.title',
          'pages.content',
          'pages.parentPageId',
          'pages.spaceId',
          'pages.workspaceId',
          'pages.updatedAt',
        ])
        .where('spaceId', '=', spaceId)
        .where('updatedAt', '>', sinceDate)
        .orderBy('updatedAt', 'desc')
        .execute();

      this.logger.log(`Found ${changedPages.length} changed pages in space ${spaceId} since ${sinceDate.toISOString()}`);
      return changedPages;
    } catch (error) {
      this.logger.error(`Failed to get changed pages for space ${spaceId}:`, error);
      return [];
    }
  }

  private async exportChangedPagesToDocusaurus(
    workspaceId: string,
    spaceId: string,
    changedPages: any[],
    options: { includeChildren?: boolean; includeAttachments?: boolean }
  ): Promise<{ success: boolean; message: string; filePath?: string }> {
    try {
      if (changedPages.length === 0) {
        return { success: true, message: 'No pages to sync' };
      }

      const config = await this.getDocusaurusConfig(workspaceId);
      if (!config) {
        throw new Error('Docusaurus configuration not found');
      }

      // Find space mapping
      const spaceMapping = config.spaceMappings.find(m => m.spaceId === spaceId);
      if (!spaceMapping) {
        throw new Error(`No Docusaurus mapping found for space ${spaceId}`);
      }

      // Get space info
      const space = await this.db
        .selectFrom('spaces')
        .selectAll()
        .where('id', '=', spaceId)
        .executeTakeFirst();

      if (!space) {
        throw new Error('Space not found');
      }

      // Create category directory and metadata
      const categoryPath = this.sanitizeFilename(spaceMapping.categoryName);
      await this.ensureDocsDirectory(config.sitePath, categoryPath);
      
      const categoryMetadata = await this.createCategoryMetadata(spaceMapping, space.name);
      await this.writeDocusaurusCategoryFile(config.sitePath, categoryPath, categoryMetadata);

      let exportedCount = 0;
      const errors: string[] = [];

      // Export each changed page
      for (const page of changedPages) {
        try {
          // Check if the page should include children based on changes
          const shouldIncludeChildren = options.includeChildren && page.parentPageId === null;
          
          const pageFilePath = await this.exportSinglePageToDocusaurus(
            config.sitePath,
            categoryPath,
            page,
            shouldIncludeChildren
          );

          if (pageFilePath) {
            exportedCount++;
            this.logger.log(`Exported changed page: ${page.title} -> ${pageFilePath}`);
          }
        } catch (error) {
          const errorMsg = `Failed to export page ${page.title}: ${(error as Error)?.message}`;
          errors.push(errorMsg);
          this.logger.error(errorMsg, error);
        }
      }

      const message = `Incremental sync completed. Exported ${exportedCount}/${changedPages.length} changed pages to ${spaceMapping.categoryName}`;
      
      if (errors.length > 0) {
        this.logger.warn(`Incremental sync had ${errors.length} errors: ${errors.join(', ')}`);
        return { 
          success: exportedCount > 0, 
          message: `${message}. ${errors.length} errors occurred.`
        };
      }

      return { success: true, message };
    } catch (error) {
      this.logger.error(`Incremental export failed for space ${spaceId}:`, error);
      return { 
        success: false, 
        message: `Incremental export failed: ${(error as Error)?.message}` 
      };
    }
  }

  private async exportSinglePageToDocusaurus(
    sitePath: string,
    categoryPath: string,
    page: any,
    includeChildren: boolean = false
  ): Promise<string | null> {
    try {
      // Convert page content to markdown using the export service
      const pageContent = await this.exportService.exportPage(ExportFormat.Docusaurus, page as any, true);
      
      // Get all pages in the same space for reference processing
      const allSpacePages = await this.db
        .selectFrom('pages')
        .select([
          'pages.id',
          'pages.slugId',
          'pages.title',
          'pages.spaceId',
        ])
        .where('spaceId', '=', page.spaceId)
        .execute();

      // Process content references
      const fileName = `${this.sanitizeFilename(page.title)}.md`;
      const pagePath = `${categoryPath}/${fileName}`;
      const processedContent = await this.processContentReferences(
        pageContent, 
        page, 
        allSpacePages, 
        categoryPath, 
        pagePath
      );

      // Create file path
      const filePath = path.join(sitePath, 'docs', categoryPath, fileName);

      // Write the file
      await writeFile(filePath, processedContent, 'utf-8');

      return filePath;
    } catch (error) {
      this.logger.error(`Failed to export single page ${page.title}:`, error);
      return null;
    }
  }

  // Enhanced Sync Monitoring Methods

  async getDetailedSyncStatus(workspaceId: string): Promise<{
    lastSync: SyncResult | null;
    nextScheduledSync: Date | null;
    isAutoSyncEnabled: boolean;
    syncInterval: string;
    pendingChanges: number;
  }> {
    try {
      const config = await this.getDocusaurusConfig(workspaceId);
      const lastSync = await this.getLastSyncStatus(workspaceId);
      
      let nextScheduledSync: Date | null = null;
      if (config?.autoSync?.enabled && lastSync) {
        const lastSyncTime = new Date(lastSync.endTime);
        switch (config.autoSync.interval) {
          case DocusaurusSyncInterval.HOURLY:
            nextScheduledSync = new Date(lastSyncTime.getTime() + 60 * 60 * 1000);
            break;
          case DocusaurusSyncInterval.DAILY:
            nextScheduledSync = new Date(lastSyncTime.getTime() + 24 * 60 * 60 * 1000);
            break;
        }
      }

      // Count pending changes since last sync
      let pendingChanges = 0;
      if (lastSync && config?.spaceMappings) {
        const lastSyncTime = new Date(lastSync.endTime);
        for (const mapping of config.spaceMappings) {
          const changedPages = await this.getChangedPagesInSpace(mapping.spaceId, lastSyncTime);
          pendingChanges += changedPages.length;
        }
      }

      return {
        lastSync,
        nextScheduledSync,
        isAutoSyncEnabled: config?.autoSync?.enabled || false,
        syncInterval: config?.autoSync?.interval || 'manual',
        pendingChanges,
      };
    } catch (error) {
      this.logger.error(`Failed to get detailed sync status for workspace ${workspaceId}:`, error);
      return {
        lastSync: null,
        nextScheduledSync: null,
        isAutoSyncEnabled: false,
        syncInterval: 'manual',
        pendingChanges: 0,
      };
    }
  }

  // Conflict Resolution Methods

  private async detectFileConflicts(
    filePath: string, 
    newContent: string,
    workspaceId: string
  ): Promise<ConflictInfo | null> {
    try {
      // Check if file exists
      const fileExists = await this.fileExists(filePath);
      if (!fileExists) {
        return null; // No conflict if file doesn't exist
      }

      // Read existing file content
      const existingContent = await readFile(filePath, 'utf-8');
      
      // Check if content is the same
      if (existingContent === newContent) {
        return null; // No conflict if content is identical
      }

      // Check if existing file is newer (has been modified since last sync)
      const fileStat = await this.getFileStats(filePath);
      const lastSyncTime = await this.getLastSyncTimestamp(workspaceId);
      
      if (lastSyncTime && fileStat.mtime > lastSyncTime) {
        return {
          filePath,
          type: 'newer_version',
          resolution: 'skip', // Default to skip for newer files
          message: `File ${path.basename(filePath)} has been modified since last sync`,
        };
      }

      return {
        filePath,
        type: 'file_exists',
        resolution: 'overwrite', // Default to overwrite for regular conflicts
        message: `File ${path.basename(filePath)} already exists and will be overwritten`,
      };
    } catch (error) {
      return {
        filePath,
        type: 'permission_denied',
        resolution: 'skip',
        message: `Cannot access file ${path.basename(filePath)}: ${(error as Error)?.message}`,
      };
    }
  }

  private async resolveConflict(
    conflict: ConflictInfo, 
    newContent: string
  ): Promise<{ resolved: boolean; action: string }> {
    try {
      switch (conflict.resolution) {
        case 'overwrite':
          await writeFile(conflict.filePath, newContent, 'utf-8');
          return { resolved: true, action: 'File overwritten' };

        case 'skip':
          return { resolved: true, action: 'File skipped due to conflict' };

        case 'merge':
          // For now, merge means overwrite with a backup
          const backupPath = `${conflict.filePath}.backup.${Date.now()}`;
          const existingContent = await readFile(conflict.filePath, 'utf-8');
          await writeFile(backupPath, existingContent, 'utf-8');
          await writeFile(conflict.filePath, newContent, 'utf-8');
          return { resolved: true, action: `File merged, backup saved to ${path.basename(backupPath)}` };

        default:
          return { resolved: false, action: 'Unknown resolution strategy' };
      }
    } catch (error) {
      return { resolved: false, action: `Resolution failed: ${(error as Error)?.message}` };
    }
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  private async getFileStats(filePath: string): Promise<{ mtime: Date }> {
    const fs = await import('fs');
    const stats = await fs.promises.stat(filePath);
    return { mtime: stats.mtime };
  }


  // Enhanced Export with Conflict Resolution

  private async exportPageWithConflictResolution(
    sitePath: string,
    categoryPath: string,
    page: any,
    workspaceId: string
  ): Promise<{ success: boolean; message: string; conflict?: ConflictInfo }> {
    try {
      // Convert page content to markdown
      const pageContent = await this.exportService.exportPage(ExportFormat.Docusaurus, page as any, true);
      
      // Get all pages in the same space for reference processing
      const allSpacePages = await this.db
        .selectFrom('pages')
        .select([
          'pages.id',
          'pages.slugId', 
          'pages.title',
          'pages.spaceId',
        ])
        .where('spaceId', '=', page.spaceId)
        .execute();

      // Process content references
      const fileName = `${this.sanitizeFilename(page.title)}.md`;
      const pagePath = `${categoryPath}/${fileName}`;
      const processedContent = await this.processContentReferences(
        pageContent,
        page,
        allSpacePages,
        categoryPath,
        pagePath
      );

      // Create file path
      const filePath = path.join(sitePath, 'docs', categoryPath, fileName);

      // Detect conflicts
      const conflict = await this.detectFileConflicts(filePath, processedContent, workspaceId);
      
      if (conflict) {
        // Resolve the conflict
        const resolution = await this.resolveConflict(conflict, processedContent);
        if (resolution.resolved) {
          return { 
            success: true, 
            message: `Page exported with conflict resolution: ${resolution.action}`,
            conflict 
          };
        } else {
          return { 
            success: false, 
            message: `Failed to resolve conflict: ${resolution.action}`,
            conflict 
          };
        }
      } else {
        // No conflict, write file normally
        await writeFile(filePath, processedContent, 'utf-8');
        return { success: true, message: 'Page exported successfully' };
      }
    } catch (error) {
      return { 
        success: false, 
        message: `Export failed: ${(error as Error)?.message}` 
      };
    }
  }

  // Sync Reporting Methods

  async generateSyncReport(syncResult: SyncResult): Promise<{
    summary: string;
    details: {
      spacesProcessed: number;
      pagesExported: number;
      conflictsResolved: number;
      errorsEncountered: number;
      duration: string;
      recommendations: string[];
    };
  }> {
    const stats = syncResult.stats;
    const duration = this.formatDuration(syncResult.duration);
    
    const successRate = stats.totalPages > 0 
      ? Math.round((stats.successfulPages / stats.totalPages) * 100) 
      : 0;

    let summary: string;
    if (syncResult.status === 'success') {
      summary = `Sync completed successfully! Exported ${stats.successfulPages} pages from ${stats.successfulSpaces} spaces in ${duration}.`;
    } else if (syncResult.status === 'partial') {
      summary = `Sync partially completed. ${stats.successfulSpaces}/${stats.totalSpaces} spaces synced successfully (${successRate}% success rate).`;
    } else {
      summary = `Sync failed. Only ${stats.successfulPages} out of ${stats.totalPages} pages were exported.`;
    }

    const recommendations: string[] = [];
    
    if (stats.errors.length > 0) {
      recommendations.push('Review and resolve the errors listed above');
    }
    
    if (stats.conflicts.length > 0) {
      recommendations.push('Consider implementing automated conflict resolution strategies');
    }
    
    if (stats.failedPages > 0) {
      recommendations.push('Check page content for invalid characters or formatting issues');
    }
    
    if (successRate < 90 && stats.totalPages > 0) {
      recommendations.push('Consider running a validation check before the next sync');
    }

    return {
      summary,
      details: {
        spacesProcessed: stats.totalSpaces,
        pagesExported: stats.successfulPages,
        conflictsResolved: stats.conflicts.length,
        errorsEncountered: stats.errors.length,
        duration,
        recommendations,
      },
    };
  }

  private formatDuration(milliseconds: number): string {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  async getSyncReport(workspaceId: string, syncId: string): Promise<{
    summary: string;
    details: {
      spacesProcessed: number;
      pagesExported: number;
      conflictsResolved: number;
      errorsEncountered: number;
      duration: string;
      recommendations: string[];
    };
    syncResult: SyncResult | null;
  }> {
    try {
      // Find the specific sync result by ID
      const syncHistory = await this.getSyncHistory(workspaceId, 50); // Get more history to find specific sync
      const syncResult = syncHistory.find(sync => sync.syncId === syncId);
      
      if (!syncResult) {
        return {
          summary: 'Sync report not found',
          details: {
            spacesProcessed: 0,
            pagesExported: 0,
            conflictsResolved: 0,
            errorsEncountered: 0,
            duration: '0s',
            recommendations: ['Sync result not found in history'],
          },
          syncResult: null,
        };
      }

      const report = await this.generateSyncReport(syncResult);
      return {
        ...report,
        syncResult,
      };
    } catch (error) {
      this.logger.error(`Failed to get sync report for ${syncId}:`, error);
      return {
        summary: 'Failed to generate sync report',
        details: {
          spacesProcessed: 0,
          pagesExported: 0,
          conflictsResolved: 0,
          errorsEncountered: 1,
          duration: '0s',
          recommendations: ['Unable to generate report due to an error'],
        },
        syncResult: null,
      };
    }
  }
}