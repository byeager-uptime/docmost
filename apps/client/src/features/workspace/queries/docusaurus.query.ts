import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { notifications } from "@mantine/notifications";
import {
  getDocusaurusConfig,
  updateDocusaurusConfig,
  validateDocusaurusSetup,
  getSpaceMappings,
  updateSpaceMapping,
  exportToDocusaurus,
  analyzeContentForCategorization,
  triggerManualSync,
  getSyncHistory,
  getLastSyncStatus,
  getDetailedSyncStatus,
} from "../services/docusaurus.service";
import { DocusaurusConfig, DocusaurusSpaceMapping, SyncResult } from "../types/docusaurus.types";

export function useDocusaurusConfig() {
  return useQuery({
    queryKey: ["docusaurus-config"],
    queryFn: getDocusaurusConfig,
  });
}

export function useUpdateDocusaurusConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateDocusaurusConfig,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["docusaurus-config"] });
      notifications.show({
        message: "Docusaurus configuration updated successfully",
        color: "green",
      });
    },
    onError: (error: any) => {
      notifications.show({
        message: error.response?.data?.message || "Failed to update configuration",
        color: "red",
      });
    },
  });
}

export function useValidateDocusaurusSetup() {
  return useMutation({
    mutationFn: validateDocusaurusSetup,
    onError: (error: any) => {
      notifications.show({
        message: error.response?.data?.message || "Validation failed",
        color: "red",
      });
    },
  });
}

export function useSpaceMappings() {
  return useQuery({
    queryKey: ["docusaurus-space-mappings"],
    queryFn: getSpaceMappings,
  });
}

export function useUpdateSpaceMapping() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ spaceId, mapping }: { spaceId: string; mapping: Partial<DocusaurusSpaceMapping> }) =>
      updateSpaceMapping(spaceId, mapping),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["docusaurus-space-mappings"] });
      notifications.show({
        message: "Space mapping updated successfully",
        color: "green",
      });
    },
    onError: (error: any) => {
      notifications.show({
        message: error.response?.data?.message || "Failed to update mapping",
        color: "red",
      });
    },
  });
}

export function useExportToDocusaurus() {
  return useMutation({
    mutationFn: ({ 
      contentId, 
      contentType, 
      options 
    }: { 
      contentId: string; 
      contentType: "page" | "space"; 
      options?: { includeChildren?: boolean; includeAttachments?: boolean } 
    }) =>
      exportToDocusaurus(contentId, contentType, options),
    onSuccess: (result) => {
      notifications.show({
        message: result.message,
        color: result.success ? "green" : "red",
      });
    },
    onError: (error: any) => {
      notifications.show({
        message: error.response?.data?.message || "Export to Docusaurus failed",
        color: "red",
      });
    },
  });
}

export function useContentAnalysis() {
  return useQuery({
    queryKey: ["docusaurus-content-analysis"],
    queryFn: analyzeContentForCategorization,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}

export function useAnalyzeContent() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: analyzeContentForCategorization,
    onSuccess: (data) => {
      queryClient.setQueryData(["docusaurus-content-analysis"], data);
      notifications.show({
        message: `Content analysis complete! Found ${data.suggestions.length} category suggestions`,
        color: "green",
      });
    },
    onError: (error: any) => {
      notifications.show({
        message: error.response?.data?.message || "Content analysis failed",
        color: "red",
      });
    },
  });
}

// Phase 4: Sync Query Hooks

export function useTriggerManualSync() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: triggerManualSync,
    onSuccess: (data: SyncResult) => {
      queryClient.invalidateQueries({ queryKey: ["docusaurus-sync-history"] });
      queryClient.invalidateQueries({ queryKey: ["docusaurus-last-sync"] });
      
      const statusColor = data.status === 'success' ? 'green' : data.status === 'partial' ? 'yellow' : 'red';
      const message = data.status === 'success' 
        ? `Sync completed successfully! Exported ${data.stats.successfulPages} pages from ${data.stats.successfulSpaces} spaces`
        : data.status === 'partial'
        ? `Sync partially completed. ${data.stats.successfulSpaces}/${data.stats.totalSpaces} spaces synced successfully`
        : `Sync failed: ${data.stats.errors[0] || 'Unknown error'}`;
      
      notifications.show({
        message,
        color: statusColor,
      });
    },
    onError: (error: any) => {
      notifications.show({
        message: error.response?.data?.message || "Manual sync failed",
        color: "red",
      });
    },
  });
}

export function useSyncHistory(limit = 10) {
  return useQuery({
    queryKey: ["docusaurus-sync-history", limit],
    queryFn: () => getSyncHistory(limit),
    refetchInterval: 30000, // Refresh every 30 seconds
  });
}

export function useLastSyncStatus() {
  return useQuery({
    queryKey: ["docusaurus-last-sync"],
    queryFn: getLastSyncStatus,
    refetchInterval: 30000, // Refresh every 30 seconds
  });
}

export function useDetailedSyncStatus() {
  return useQuery({
    queryKey: ["docusaurus-detailed-sync-status"],
    queryFn: getDetailedSyncStatus,
    refetchInterval: 30000, // Refresh every 30 seconds
  });
}