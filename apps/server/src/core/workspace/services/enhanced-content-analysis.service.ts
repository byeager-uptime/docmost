import { Injectable, Logger } from '@nestjs/common';
import { CategorySuggestion, ContentAnalysis, ContentCluster, PageRelationship } from './docusaurus.service';

// Enhanced AI-powered content analysis service
@Injectable()
export class EnhancedContentAnalysisService {
  private readonly logger = new Logger(EnhancedContentAnalysisService.name);

  /**
   * Perform intelligent content analysis using NLP techniques
   */
  async performIntelligentAnalysis(pages: any[]): Promise<ContentAnalysis> {
    this.logger.log(`Performing intelligent analysis on ${pages.length} pages`);

    // Extract content and metadata
    const documents = this.preprocessDocuments(pages);
    
    // Generate TF-IDF vectors for semantic analysis
    const tfidfVectors = await this.generateTFIDFVectors(documents);
    
    // Perform semantic clustering
    const clusters = await this.performSemanticClustering(documents, tfidfVectors);
    
    // Extract relationships using content analysis
    const relationships = await this.extractContentRelationships(pages, documents);
    
    // Generate enhanced keyword analysis
    const keywords = await this.extractSemanticKeywords(documents);

    return {
      keywords,
      pageTags: this.generatePageTags(documents),
      relationships,
      clusters,
    };
  }

  /**
   * Generate intelligent category suggestions based on content analysis
   */
  async generateIntelligentSuggestions(
    spaces: any[],
    pages: any[],
    analysis: ContentAnalysis
  ): Promise<CategorySuggestion[]> {
    const suggestions: CategorySuggestion[] = [];

    // Cluster-based suggestions with semantic analysis
    for (const cluster of analysis.clusters) {
      if (cluster.pages.length >= 3) {
        const suggestion = await this.generateClusterSuggestion(cluster, pages, spaces);
        if (suggestion) suggestions.push(suggestion);
      }
    }

    // Topic-based suggestions using keyword analysis
    const topicSuggestions = await this.generateTopicBasedSuggestions(
      analysis.keywords,
      pages,
      spaces
    );
    suggestions.push(...topicSuggestions);

    // Hierarchy-based suggestions
    const hierarchySuggestions = await this.generateHierarchyBasedSuggestions(
      analysis.relationships,
      pages,
      spaces
    );
    suggestions.push(...hierarchySuggestions);

    return suggestions
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 10); // Top 10 suggestions
  }

  /**
   * Preprocess documents for analysis
   */
  private preprocessDocuments(pages: any[]): ProcessedDocument[] {
    return pages.map(page => ({
      id: page.id,
      title: page.title || '',
      content: this.extractTextFromContent(page.content || '{}'),
      spaceId: page.spaceId,
      parentPageId: page.parentPageId,
      createdAt: new Date(page.createdAt),
      updatedAt: new Date(page.updatedAt),
    }));
  }

  /**
   * Generate TF-IDF vectors for semantic analysis
   */
  private async generateTFIDFVectors(documents: ProcessedDocument[]): Promise<Map<string, number[]>> {
    const vocabulary = this.buildVocabulary(documents);
    const vectors = new Map<string, number[]>();

    for (const doc of documents) {
      const vector = this.calculateTFIDF(doc, documents, vocabulary);
      vectors.set(doc.id, vector);
    }

    return vectors;
  }

  /**
   * Build vocabulary from all documents
   */
  private buildVocabulary(documents: ProcessedDocument[]): string[] {
    const wordFreq = new Map<string, number>();
    
    for (const doc of documents) {
      const words = this.tokenize(doc.title + ' ' + doc.content);
      for (const word of words) {
        wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
      }
    }

    // Filter words by frequency and length
    return Array.from(wordFreq.entries())
      .filter(([word, freq]) => freq > 1 && word.length > 2 && word.length < 20)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 1000) // Top 1000 words
      .map(([word]) => word);
  }

  /**
   * Calculate TF-IDF vector for a document
   */
  private calculateTFIDF(
    doc: ProcessedDocument,
    allDocs: ProcessedDocument[],
    vocabulary: string[]
  ): number[] {
    const words = this.tokenize(doc.title + ' ' + doc.content);
    const wordCount = words.length;
    const vector: number[] = [];

    for (const term of vocabulary) {
      // Term Frequency
      const tf = words.filter(word => word === term).length / wordCount;
      
      // Inverse Document Frequency
      const docsWithTerm = allDocs.filter(d => 
        this.tokenize(d.title + ' ' + d.content).includes(term)
      ).length;
      const idf = Math.log(allDocs.length / (docsWithTerm || 1));
      
      vector.push(tf * idf);
    }

    return vector;
  }

  /**
   * Perform semantic clustering using cosine similarity
   */
  private async performSemanticClustering(
    documents: ProcessedDocument[],
    vectors: Map<string, number[]>
  ): Promise<ContentCluster[]> {
    const clusters: ContentCluster[] = [];
    const processed = new Set<string>();

    for (const doc of documents) {
      if (processed.has(doc.id)) continue;

      const docVector = vectors.get(doc.id) || [];
      const cluster: ContentCluster = {
        id: `semantic_cluster_${clusters.length}`,
        pages: [doc.id],
        commonTags: this.extractTopKeywords(doc),
        similarity: 1.0,
      };

      // Find semantically similar documents
      for (const otherDoc of documents) {
        if (doc.id === otherDoc.id || processed.has(otherDoc.id)) continue;

        const otherVector = vectors.get(otherDoc.id) || [];
        const similarity = this.cosineSimilarity(docVector, otherVector);

        if (similarity > 0.5) { // 50% similarity threshold
          cluster.pages.push(otherDoc.id);
          cluster.commonTags = this.mergeKeywords(
            cluster.commonTags,
            this.extractTopKeywords(otherDoc)
          );
          processed.add(otherDoc.id);
        }
      }

      if (cluster.pages.length > 1) {
        cluster.similarity = this.calculateClusterCohesion(cluster, vectors);
        clusters.push(cluster);
      }

      processed.add(doc.id);
    }

    return clusters.sort((a, b) => b.similarity - a.similarity);
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
      dotProduct += vecA[i] * vecB[i];
      normA += vecA[i] * vecA[i];
      normB += vecB[i] * vecB[i];
    }

    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  /**
   * Extract content relationships using advanced analysis
   */
  private async extractContentRelationships(
    pages: any[],
    documents: ProcessedDocument[]
  ): Promise<PageRelationship[]> {
    const relationships: PageRelationship[] = [];

    // Hierarchical relationships
    for (const page of pages) {
      if (page.parentPageId) {
        relationships.push({
          parentId: page.parentPageId,
          childId: page.id,
          type: 'hierarchical',
        });
      }
    }

    // Content-based relationships using entity extraction
    for (const doc of documents) {
      const entities = this.extractEntities(doc.content);
      
      for (const otherDoc of documents) {
        if (doc.id === otherDoc.id) continue;
        
        const otherEntities = this.extractEntities(otherDoc.content);
        const sharedEntities = entities.filter(e => otherEntities.includes(e));
        
        if (sharedEntities.length >= 2) {
          relationships.push({
            parentId: doc.id,
            childId: otherDoc.id,
            type: 'reference',
          });
        }
      }
    }

    return relationships;
  }

  /**
   * Extract semantic keywords using TF-IDF and clustering
   */
  private async extractSemanticKeywords(documents: ProcessedDocument[]): Promise<[string, number][]> {
    const termFrequency = new Map<string, number>();
    const documentFrequency = new Map<string, number>();

    // Calculate term and document frequencies
    for (const doc of documents) {
      const words = this.tokenize(doc.title + ' ' + doc.content);
      const uniqueWords = new Set(words);

      words.forEach(word => {
        termFrequency.set(word, (termFrequency.get(word) || 0) + 1);
      });

      uniqueWords.forEach(word => {
        documentFrequency.set(word, (documentFrequency.get(word) || 0) + 1);
      });
    }

    // Calculate TF-IDF scores
    const tfidfScores: [string, number][] = [];
    
    for (const [term, tf] of termFrequency.entries()) {
      const df = documentFrequency.get(term) || 1;
      const idf = Math.log(documents.length / df);
      const tfidf = tf * idf;
      
      if (term.length > 2 && term.length < 20 && !this.isStopWord(term)) {
        tfidfScores.push([term, tfidf]);
      }
    }

    return tfidfScores
      .sort((a, b) => b[1] - a[1])
      .slice(0, 50);
  }

  /**
   * Generate cluster-based category suggestion
   */
  private async generateClusterSuggestion(
    cluster: ContentCluster,
    pages: any[],
    spaces: any[]
  ): Promise<CategorySuggestion | null> {
    const clusterPages = pages.filter(p => cluster.pages.includes(p.id));
    const spaceIds = [...new Set(clusterPages.map(p => p.spaceId))];

    if (cluster.commonTags.length === 0) return null;

    const categoryName = this.generateSmartCategoryName(cluster.commonTags);
    const confidence = Math.min(0.95, cluster.similarity * 0.7 + (cluster.commonTags.length * 0.1));

    return {
      type: 'content-cluster',
      categoryName,
      suggestedSpaces: spaceIds,
      confidence,
      reasoning: `Semantic analysis identified ${clusterPages.length} related pages with shared concepts: ${cluster.commonTags.slice(0, 3).join(', ')}`,
      pages: cluster.pages,
    };
  }

  /**
   * Generate topic-based suggestions using keyword analysis
   */
  private async generateTopicBasedSuggestions(
    keywords: [string, number][],
    pages: any[],
    spaces: any[]
  ): Promise<CategorySuggestion[]> {
    const suggestions: CategorySuggestion[] = [];
    const topKeywords = keywords.slice(0, 10);

    for (const [keyword, score] of topKeywords) {
      const relatedPages = pages.filter(page =>
        this.tokenize((page.title + ' ' + this.extractTextFromContent(page.content || '{}')).toLowerCase())
          .includes(keyword)
      );

      if (relatedPages.length >= 3) {
        const spaceIds = [...new Set(relatedPages.map(p => p.spaceId))];
        
        suggestions.push({
          type: 'keyword-based',
          categoryName: this.capitalize(keyword),
          suggestedSpaces: spaceIds,
          confidence: Math.min(0.8, (score / keywords[0][1]) * 0.8),
          reasoning: `Pages frequently discuss "${keyword}" (${relatedPages.length} pages)`,
          pages: relatedPages.map(p => p.id),
        });
      }
    }

    return suggestions;
  }

  /**
   * Generate hierarchy-based suggestions
   */
  private async generateHierarchyBasedSuggestions(
    relationships: PageRelationship[],
    pages: any[],
    spaces: any[]
  ): Promise<CategorySuggestion[]> {
    const suggestions: CategorySuggestion[] = [];
    
    // Find pages with many children (likely main topics)
    const parentCounts = new Map<string, number>();
    
    for (const rel of relationships.filter(r => r.type === 'hierarchical')) {
      parentCounts.set(rel.parentId, (parentCounts.get(rel.parentId) || 0) + 1);
    }

    for (const [parentId, childCount] of parentCounts.entries()) {
      if (childCount >= 3) {
        const parentPage = pages.find(p => p.id === parentId);
        if (parentPage) {
          const childPages = pages.filter(p => p.parentPageId === parentId);
          
          suggestions.push({
            type: 'space-based',
            categoryName: parentPage.title || 'Hierarchical Section',
            suggestedSpaces: [parentPage.spaceId],
            confidence: 0.75,
            reasoning: `"${parentPage.title}" has ${childCount} sub-pages, indicating a major topic`,
            pages: [parentId, ...childPages.map(p => p.id)],
          });
        }
      }
    }

    return suggestions;
  }

  // Utility methods
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 0);
  }

  private extractTextFromContent(content: string): string {
    try {
      const contentObj = JSON.parse(content);
      return this.extractTextFromNode(contentObj);
    } catch {
      return '';
    }
  }

  private extractTextFromNode(node: any): string {
    if (!node) return '';

    let text = '';
    if (node.text) text += node.text + ' ';
    if (node.content && Array.isArray(node.content)) {
      for (const child of node.content) {
        text += this.extractTextFromNode(child);
      }
    }

    return text;
  }

  private extractTopKeywords(doc: ProcessedDocument): string[] {
    const words = this.tokenize(doc.title + ' ' + doc.content);
    const wordFreq = new Map<string, number>();

    words.forEach(word => {
      if (!this.isStopWord(word) && word.length > 2) {
        wordFreq.set(word, (wordFreq.get(word) || 0) + 1);
      }
    });

    return Array.from(wordFreq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([word]) => word);
  }

  private mergeKeywords(keywords1: string[], keywords2: string[]): string[] {
    const merged = new Set([...keywords1, ...keywords2]);
    return Array.from(merged).slice(0, 8);
  }

  private calculateClusterCohesion(cluster: ContentCluster, vectors: Map<string, number[]>): number {
    if (cluster.pages.length < 2) return 1.0;

    let totalSimilarity = 0;
    let comparisons = 0;

    for (let i = 0; i < cluster.pages.length; i++) {
      for (let j = i + 1; j < cluster.pages.length; j++) {
        const vec1 = vectors.get(cluster.pages[i]) || [];
        const vec2 = vectors.get(cluster.pages[j]) || [];
        totalSimilarity += this.cosineSimilarity(vec1, vec2);
        comparisons++;
      }
    }

    return comparisons > 0 ? totalSimilarity / comparisons : 0;
  }

  private extractEntities(content: string): string[] {
    // Simple entity extraction - could be enhanced with NER libraries
    const entities: string[] = [];
    const text = content.toLowerCase();

    // Extract capitalized words (potential entities)
    const words = content.split(/\s+/);
    for (const word of words) {
      if (/^[A-Z][a-z]+/.test(word) && word.length > 3) {
        entities.push(word.toLowerCase());
      }
    }

    return [...new Set(entities)];
  }

  private generateSmartCategoryName(tags: string[]): string {
    if (tags.length === 0) return 'General';
    
    // Look for common technical patterns
    const apiKeywords = ['api', 'endpoint', 'rest', 'graphql'];
    const guideKeywords = ['guide', 'tutorial', 'howto', 'setup'];
    const conceptKeywords = ['concept', 'overview', 'introduction', 'basics'];

    const mainTag = this.capitalize(tags[0]);

    if (tags.some(tag => apiKeywords.some(keyword => tag.includes(keyword)))) {
      return `${mainTag} API`;
    }
    if (tags.some(tag => guideKeywords.some(keyword => tag.includes(keyword)))) {
      return `${mainTag} Guides`;
    }
    if (tags.some(tag => conceptKeywords.some(keyword => tag.includes(keyword)))) {
      return `${mainTag} Concepts`;
    }

    return mainTag;
  }

  private generatePageTags(documents: ProcessedDocument[]): Map<string, string[]> {
    const pageTags = new Map<string, string[]>();
    
    for (const doc of documents) {
      const tags = this.extractTopKeywords(doc);
      pageTags.set(doc.id, tags);
    }

    return pageTags;
  }

  private isStopWord(word: string): boolean {
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
      'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do', 'does', 'did',
      'will', 'would', 'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these', 'those',
      'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
      'my', 'your', 'his', 'her', 'its', 'our', 'their', 'page', 'content', 'documentation',
      'doc', 'docs', 'document', 'section', 'chapter', 'part', 'item', 'list', 'example'
    ]);
    
    return stopWords.has(word.toLowerCase());
  }

  private capitalize(word: string): string {
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  }
}

// Interface for processed documents
interface ProcessedDocument {
  id: string;
  title: string;
  content: string;
  spaceId: string;
  parentPageId?: string;
  createdAt: Date;
  updatedAt: Date;
}