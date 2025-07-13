import api from "@/lib/api-client";
import { 
  DocusaurusConfig, 
  DocusaurusValidation, 
  DocusaurusSpaceMapping,
  ContentAnalysisResult,
  SyncResult
} from "../types/docusaurus.types";

export async function getDocusaurusConfig(): Promise<DocusaurusConfig | null> {
  const req = await api.post("/workspace/docusaurus/config");
  return req.data;
}

export async function updateDocusaurusConfig(config: DocusaurusConfig): Promise<DocusaurusConfig> {
  const req = await api.post("/workspace/docusaurus/config/update", config);
  return req.data;
}

export async function validateDocusaurusSetup(): Promise<DocusaurusValidation> {
  const req = await api.post("/workspace/docusaurus/validate");
  return req.data;
}

export async function getSpaceMappings(): Promise<DocusaurusSpaceMapping[]> {
  const req = await api.post("/workspace/docusaurus/mappings");
  return req.data;
}

export async function updateSpaceMapping(
  spaceId: string, 
  mapping: Partial<DocusaurusSpaceMapping>
): Promise<DocusaurusSpaceMapping[]> {
  const req = await api.post("/workspace/docusaurus/mappings/update", {
    spaceId,
    mapping
  });
  return req.data;
}

export async function exportToDocusaurus(
  contentId: string,
  contentType: "page" | "space",
  options: {
    includeChildren?: boolean;
    includeAttachments?: boolean;
  } = {}
): Promise<{ success: boolean; message: string; filePath?: string }> {
  const req = await api.post("/workspace/docusaurus/export", {
    contentId,
    contentType,
    options
  });
  return req.data;
}

export async function analyzeContentForCategorization(): Promise<ContentAnalysisResult> {
  const req = await api.post("/workspace/docusaurus/analyze");
  return req.data;
}

// Phase 4: Sync Service Functions

export async function triggerManualSync(): Promise<SyncResult> {
  const req = await api.post("/workspace/docusaurus/sync/manual");
  return req.data;
}

export async function getSyncHistory(limit = 10): Promise<SyncResult[]> {
  const req = await api.post("/workspace/docusaurus/sync/history", { limit });
  return req.data;
}

export async function getLastSyncStatus(): Promise<SyncResult | null> {
  const req = await api.post("/workspace/docusaurus/sync/status");
  return req.data;
}

export async function getDetailedSyncStatus(): Promise<{
  lastSync: SyncResult | null;
  nextScheduledSync: string | null;
  isAutoSyncEnabled: boolean;
  syncInterval: string;
  pendingChanges: number;
}> {
  const req = await api.post("/workspace/docusaurus/sync/status/detailed");
  return req.data;
}

export async function getAvailablePages(): Promise<Array<{
  id: string;
  title: string;
  slug: string;
  spaceId: string;
  spaceName: string;
  displayText: string;
}>> {
  const req = await api.post("/workspace/docusaurus/pages");
  return req.data;
}