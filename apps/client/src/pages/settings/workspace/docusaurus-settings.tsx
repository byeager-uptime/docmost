import React, { useState } from "react";
import { 
  Stack, 
  Text, 
  Switch, 
  TextInput, 
  Select, 
  Button, 
  Card, 
  Group, 
  Alert,
  Loader,
  Divider,
  ActionIcon
} from "@mantine/core";
import { useForm } from "@mantine/form";
import { IconInfoCircle, IconCheck, IconX, IconPlus, IconTrash } from "@tabler/icons-react";
import SettingsTitle from "@/components/settings/settings-title.tsx";
import { useTranslation } from "react-i18next";
import { getAppName } from "@/lib/config.ts";
import { Helmet } from "react-helmet-async";
import {
  useDocusaurusConfig,
  useUpdateDocusaurusConfig,
  useValidateDocusaurusSetup,
  useSpaceMappings,
  useUpdateSpaceMapping,
  useContentAnalysis,
  useAnalyzeContent,
  useTriggerManualSync,
  useSyncHistory,
  useLastSyncStatus,
  useDetailedSyncStatus,
} from "@/features/workspace/queries/docusaurus.query";
import { 
  DocusaurusConfig, 
  DocusaurusSyncInterval,
  DocusaurusSpaceMapping,
  CategorySuggestion,
  ContentAnalysisStats,
  SyncResult
} from "@/features/workspace/types/docusaurus.types";
import { useGetSpacesQuery } from "@/features/space/queries/space-query";

export default function DocusaurusSettings() {
  const { t } = useTranslation();
  const [validationResults, setValidationResults] = useState<any>(null);
  
  const { data: config, isLoading: configLoading } = useDocusaurusConfig();
  const { data: spaceMappings, isLoading: mappingsLoading } = useSpaceMappings();
  const { data: spaces } = useGetSpacesQuery();
  const { data: contentAnalysis } = useContentAnalysis();
  const { data: syncHistory } = useSyncHistory();
  const { data: lastSyncStatus } = useLastSyncStatus();
  const { data: detailedSyncStatus } = useDetailedSyncStatus();
  
  const updateConfigMutation = useUpdateDocusaurusConfig();
  const validateMutation = useValidateDocusaurusSetup();
  const updateMappingMutation = useUpdateSpaceMapping();
  const analyzeContentMutation = useAnalyzeContent();
  const triggerSyncMutation = useTriggerManualSync();

  const form = useForm<DocusaurusConfig>({
    initialValues: {
      enabled: false,
      sitePath: "",
      baseUrl: "",
      siteTitle: "",
      autoSync: {
        enabled: false,
        interval: DocusaurusSyncInterval.HOURLY,
      },
      spaceMappings: [],
    },
  });

  React.useEffect(() => {
    if (config) {
      form.setValues(config);
    }
  }, [config]);

  const handleSubmit = (values: DocusaurusConfig) => {
    updateConfigMutation.mutate(values);
  };

  const handleValidate = async () => {
    try {
      const result = await validateMutation.mutateAsync();
      setValidationResults(result);
    } catch (error) {
      console.error("Validation failed:", error);
    }
  };

  const handleAddSpaceMapping = () => {
    const unmappedSpaces = spaces?.items?.filter(space => 
      !spaceMappings?.some(mapping => mapping.spaceId === space.id)
    ) || [];
    
    if (unmappedSpaces.length > 0) {
      const newMapping: DocusaurusSpaceMapping = {
        spaceId: unmappedSpaces[0].id,
        categoryName: unmappedSpaces[0].name,
        position: (spaceMappings?.length || 0) + 1,
        description: `Documentation for ${unmappedSpaces[0].name}`,
        collapsed: false,
      };
      
      updateMappingMutation.mutate({
        spaceId: newMapping.spaceId,
        mapping: newMapping,
      });
    }
  };

  const handleUpdateMapping = (spaceId: string, field: string, value: any) => {
    const mapping = spaceMappings?.find(m => m.spaceId === spaceId);
    if (mapping) {
      updateMappingMutation.mutate({
        spaceId,
        mapping: { ...mapping, [field]: value },
      });
    }
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return '#228be6'; // blue
    if (confidence >= 0.6) return '#40c057'; // green  
    if (confidence >= 0.4) return '#fab005'; // yellow
    return '#fd7e14'; // orange
  };

  const applySuggestion = (suggestion: CategorySuggestion) => {
    // Apply the category suggestion by creating/updating space mappings
    suggestion.suggestedSpaces.forEach((spaceId, index) => {
      const existingMapping = spaceMappings?.find(m => m.spaceId === spaceId);
      const newMapping: DocusaurusSpaceMapping = {
        spaceId,
        categoryName: suggestion.categoryName,
        position: existingMapping?.position || (spaceMappings?.length || 0) + index + 1,
        description: `Auto-generated: ${suggestion.reasoning}`,
        collapsed: false,
      };

      updateMappingMutation.mutate({
        spaceId,
        mapping: newMapping,
      });
    });
  };

  const getSyncStatusColor = (status: string) => {
    switch (status) {
      case 'success': return 'green';
      case 'partial': return 'yellow';
      case 'failed': return 'red';
      case 'in_progress': return 'blue';
      default: return 'gray';
    }
  };

  const formatDuration = (milliseconds: number) => {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleString();
  };

  if (configLoading || mappingsLoading) {
    return <Loader />;
  }

  const unmappedSpaces = spaces?.items?.filter(space => 
    !spaceMappings?.some(mapping => mapping.spaceId === space.id)
  ) || [];

  return (
    <>
      <Helmet>
        <title>Docusaurus Integration - {getAppName()}</title>
      </Helmet>
      
      <SettingsTitle title="Docusaurus Integration" />
      
      <Alert icon={<IconInfoCircle size="1rem" />} mb="md">
        Integrate with Docusaurus to automatically publish your Docmost content to a beautiful documentation site.
      </Alert>

      <form onSubmit={form.onSubmit(handleSubmit)}>
        <Stack gap="md">
          <Card shadow="sm" padding="lg" radius="md" withBorder>
            <Text size="sm" fw={500} mb="md">Basic Configuration</Text>
            
            <Stack gap="sm">
              <Switch
                label="Enable Docusaurus Integration"
                description="Allow content to be published to your Docusaurus site"
                {...form.getInputProps("enabled", { type: "checkbox" })}
              />

              <TextInput
                label="Docusaurus Site Path"
                description="Absolute path to your Docusaurus project directory"
                placeholder="/path/to/your/docusaurus-site"
                {...form.getInputProps("sitePath")}
                disabled={!form.values.enabled}
              />

              <TextInput
                label="Base URL"
                description="The base URL where your documentation will be served"
                placeholder="http://localhost:3001/docs/"
                {...form.getInputProps("baseUrl")}
                disabled={!form.values.enabled}
              />

              <TextInput
                label="Site Title (Optional)"
                description="Title for your documentation site"
                placeholder="Company Documentation"
                {...form.getInputProps("siteTitle")}
                disabled={!form.values.enabled}
              />
            </Stack>
          </Card>

          <Card shadow="sm" padding="lg" radius="md" withBorder>
            <Text size="sm" fw={500} mb="md">Auto-Sync Settings</Text>
            
            <Stack gap="sm">
              <Switch
                label="Enable Automatic Sync"
                description="Automatically sync content changes to Docusaurus"
                {...form.getInputProps("autoSync.enabled", { type: "checkbox" })}
                disabled={!form.values.enabled}
              />

              <Select
                label="Sync Interval"
                description="How often to sync content"
                data={[
                  { value: DocusaurusSyncInterval.MANUAL, label: "Manual Only" },
                  { value: DocusaurusSyncInterval.HOURLY, label: "Every Hour" },
                  { value: DocusaurusSyncInterval.DAILY, label: "Daily" },
                ]}
                {...form.getInputProps("autoSync.interval")}
                disabled={!form.values.enabled || !form.values.autoSync.enabled}
              />
            </Stack>
          </Card>

          <Group>
            <Button 
              type="submit" 
              loading={updateConfigMutation.isPending}
              disabled={!form.values.enabled}
            >
              Save Configuration
            </Button>
            
            <Button 
              variant="outline" 
              onClick={handleValidate}
              loading={validateMutation.isPending}
              disabled={!form.values.enabled || !form.values.sitePath}
            >
              Validate Setup
            </Button>
          </Group>

          {validationResults && (
            <Alert 
              icon={validationResults.valid ? <IconCheck size="1rem" /> : <IconX size="1rem" />}
              color={validationResults.valid ? "green" : "red"}
            >
              <Text size="sm" fw={500}>
                {validationResults.valid ? "Setup Valid!" : "Setup Issues Found"}
              </Text>
              {validationResults.errors?.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: "1rem" }}>
                  {validationResults.errors.map((error: string, index: number) => (
                    <li key={index}>{error}</li>
                  ))}
                </ul>
              )}
            </Alert>
          )}
        </Stack>
      </form>

      {form.values.enabled && (
        <>
          <Divider my="xl" />
          
          <SettingsTitle title="Space Mappings" />
          
          <Text size="sm" c="dimmed" mb="md">
            Configure how your Docmost Spaces map to Docusaurus categories
          </Text>

          <Stack gap="md">
            {spaceMappings?.map((mapping) => {
              const space = spaces?.items?.find(s => s.id === mapping.spaceId);
              return (
                <Card key={mapping.spaceId} shadow="sm" padding="md" radius="md" withBorder>
                  <Group justify="space-between" mb="sm">
                    <Text size="sm" fw={500}>{space?.name || mapping.spaceId}</Text>
                    <ActionIcon 
                      variant="subtle" 
                      color="red"
                      onClick={() => updateMappingMutation.mutate({
                        spaceId: mapping.spaceId,
                        mapping: { ...mapping, spaceId: "" } // This will remove it
                      })}
                    >
                      <IconTrash size="1rem" />
                    </ActionIcon>
                  </Group>
                  
                  <Group grow>
                    <TextInput
                      label="Category Name"
                      value={mapping.categoryName}
                      onChange={(event) => 
                        handleUpdateMapping(mapping.spaceId, "categoryName", event.currentTarget.value)
                      }
                    />
                    
                    <TextInput
                      label="Position"
                      type="number"
                      value={mapping.position}
                      onChange={(event) => 
                        handleUpdateMapping(mapping.spaceId, "position", parseInt(event.currentTarget.value))
                      }
                    />
                  </Group>
                  
                  <TextInput
                    label="Description"
                    value={mapping.description || ""}
                    onChange={(event) => 
                      handleUpdateMapping(mapping.spaceId, "description", event.currentTarget.value)
                    }
                    mt="sm"
                  />
                  
                  <Switch
                    label="Collapsed by default"
                    checked={mapping.collapsed || false}
                    onChange={(event) => 
                      handleUpdateMapping(mapping.spaceId, "collapsed", event.currentTarget.checked)
                    }
                    mt="sm"
                  />
                </Card>
              );
            })}

            {unmappedSpaces.length > 0 && (
              <Button
                variant="outline"
                leftSection={<IconPlus size="1rem" />}
                onClick={handleAddSpaceMapping}
                loading={updateMappingMutation.isPending}
              >
                Add Space Mapping ({unmappedSpaces.length} spaces available)
              </Button>
            )}
          </Stack>
        </>
      )}

      {form.values.enabled && (
        <>
          <Divider my="xl" />
          
          <SettingsTitle title="Content Analysis & Suggestions" />
          
          <Text size="sm" c="dimmed" mb="md">
            Analyze your content to get intelligent category suggestions and hierarchy insights
          </Text>

          <Stack gap="md">
            <Group>
              <Button
                variant="outline"
                onClick={() => analyzeContentMutation.mutate()}
                loading={analyzeContentMutation.isPending}
              >
                Analyze Content
              </Button>
              
              {contentAnalysis && (
                <Text size="sm" c="dimmed">
                  Last analyzed: {contentAnalysis.stats.totalPages} pages across {contentAnalysis.stats.totalSpaces} spaces
                </Text>
              )}
            </Group>

            {contentAnalysis && (
              <>
                <Card shadow="sm" padding="lg" radius="md" withBorder>
                  <Text size="sm" fw={500} mb="md">Content Statistics</Text>
                  
                  <Group grow>
                    <div>
                      <Text size="lg" fw={700}>{contentAnalysis.stats.totalPages}</Text>
                      <Text size="xs" c="dimmed">Total Pages</Text>
                    </div>
                    <div>
                      <Text size="lg" fw={700}>{contentAnalysis.stats.totalSpaces}</Text>
                      <Text size="xs" c="dimmed">Spaces</Text>
                    </div>
                    <div>
                      <Text size="lg" fw={700}>{contentAnalysis.stats.totalClusters}</Text>
                      <Text size="xs" c="dimmed">Content Clusters</Text>
                    </div>
                    <div>
                      <Text size="lg" fw={700}>{contentAnalysis.stats.hierarchicalPages}</Text>
                      <Text size="xs" c="dimmed">Nested Pages</Text>
                    </div>
                  </Group>

                  {contentAnalysis.stats.topKeywords.length > 0 && (
                    <div>
                      <Text size="sm" fw={500} mt="md" mb="xs">Top Keywords</Text>
                      <Group gap="xs">
                        {contentAnalysis.stats.topKeywords.slice(0, 8).map(([keyword, count]) => (
                          <div key={keyword} style={{ 
                            padding: '4px 8px', 
                            backgroundColor: 'var(--mantine-color-gray-1)', 
                            borderRadius: '4px',
                            fontSize: '12px'
                          }}>
                            {keyword} ({count})
                          </div>
                        ))}
                      </Group>
                    </div>
                  )}
                </Card>

                {contentAnalysis.suggestions.length > 0 && (
                  <Card shadow="sm" padding="lg" radius="md" withBorder>
                    <Text size="sm" fw={500} mb="md">Category Suggestions</Text>
                    
                    <Stack gap="sm">
                      {contentAnalysis.suggestions.slice(0, 5).map((suggestion, index) => (
                        <div 
                          key={index}
                          style={{ 
                            padding: '12px', 
                            border: '1px solid var(--mantine-color-gray-3)', 
                            borderRadius: '8px',
                            backgroundColor: 'var(--mantine-color-gray-0)'
                          }}
                        >
                          <Group justify="space-between" mb="xs">
                            <Text size="sm" fw={500}>{suggestion.categoryName}</Text>
                            <div style={{ 
                              padding: '2px 6px', 
                              backgroundColor: getConfidenceColor(suggestion.confidence),
                              color: 'white',
                              borderRadius: '4px',
                              fontSize: '11px'
                            }}>
                              {Math.round(suggestion.confidence * 100)}% confidence
                            </div>
                          </Group>
                          
                          <Text size="xs" c="dimmed" mb="xs">{suggestion.reasoning}</Text>
                          
                          <Group gap="xs">
                            <Text size="xs" c="dimmed">{suggestion.pages.length} pages</Text>
                            <Text size="xs" c="dimmed">•</Text>
                            <Text size="xs" c="dimmed">{suggestion.type}</Text>
                          </Group>
                          
                          <Button
                            size="xs"
                            variant="light"
                            mt="xs"
                            onClick={() => applySuggestion(suggestion)}
                          >
                            Apply Suggestion
                          </Button>
                        </div>
                      ))}
                    </Stack>
                  </Card>
                )}
              </>
            )}
          </Stack>
        </>
      )}

      {form.values.enabled && (
        <>
          <Divider my="xl" />
          
          <SettingsTitle title="Sync Management & History" />
          
          <Text size="sm" c="dimmed" mb="md">
            Manage automated synchronization and view sync history
          </Text>

          <Stack gap="md">
            {/* Enhanced Sync Status */}
            {detailedSyncStatus && (
              <Card shadow="sm" padding="lg" radius="md" withBorder>
                <Text size="sm" fw={500} mb="md">Sync Status & Monitoring</Text>
                
                <Group grow mb="md">
                  {/* Last Sync Status */}
                  <div>
                    <Text size="xs" c="dimmed" mb={4}>Last Sync</Text>
                    {detailedSyncStatus.lastSync ? (
                      <>
                        <Text size="lg" fw={700} c={getSyncStatusColor(detailedSyncStatus.lastSync.status)}>
                          {detailedSyncStatus.lastSync.status.toUpperCase()}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {formatDate(detailedSyncStatus.lastSync.endTime)}
                        </Text>
                        <Text size="xs" c="dimmed">
                          {detailedSyncStatus.lastSync.stats.successfulPages} pages synced
                        </Text>
                      </>
                    ) : (
                      <Text size="sm" c="dimmed">No sync performed yet</Text>
                    )}
                  </div>

                  {/* Auto-Sync Status */}
                  <div>
                    <Text size="xs" c="dimmed" mb={4}>Auto-Sync</Text>
                    <Text size="lg" fw={700} c={detailedSyncStatus.isAutoSyncEnabled ? "green" : "gray"}>
                      {detailedSyncStatus.isAutoSyncEnabled ? "ENABLED" : "DISABLED"}
                    </Text>
                    <Text size="xs" c="dimmed">
                      Interval: {detailedSyncStatus.syncInterval}
                    </Text>
                    {detailedSyncStatus.nextScheduledSync && (
                      <Text size="xs" c="dimmed">
                        Next: {formatDate(detailedSyncStatus.nextScheduledSync)}
                      </Text>
                    )}
                  </div>

                  {/* Pending Changes */}
                  <div>
                    <Text size="xs" c="dimmed" mb={4}>Pending Changes</Text>
                    <Text size="lg" fw={700} c={detailedSyncStatus.pendingChanges > 0 ? "orange" : "green"}>
                      {detailedSyncStatus.pendingChanges}
                    </Text>
                    <Text size="xs" c="dimmed">
                      {detailedSyncStatus.pendingChanges === 0 ? "Up to date" : 
                       detailedSyncStatus.pendingChanges === 1 ? "page changed" : "pages changed"}
                    </Text>
                  </div>
                </Group>

                {detailedSyncStatus.lastSync?.stats.errors.length > 0 && (
                  <div>
                    <Text size="xs" fw={500} c="red" mb="xs">Recent Errors:</Text>
                    {detailedSyncStatus.lastSync.stats.errors.slice(0, 2).map((error, index) => (
                      <Text key={index} size="xs" c="dimmed" mb="xs">
                        • {error}
                      </Text>
                    ))}
                  </div>
                )}
              </Card>
            )}

            {/* Manual Sync Controls */}
            <Card shadow="sm" padding="lg" radius="md" withBorder>
              <Text size="sm" fw={500} mb="md">Manual Sync</Text>
              
              <Group>
                <Button
                  onClick={() => triggerSyncMutation.mutate()}
                  loading={triggerSyncMutation.isPending}
                  disabled={!spaceMappings || spaceMappings.length === 0}
                >
                  Trigger Manual Sync
                </Button>
                
                {(!spaceMappings || spaceMappings.length === 0) && (
                  <Text size="xs" c="dimmed">
                    Configure space mappings to enable sync
                  </Text>
                )}
              </Group>
            </Card>

            {/* Sync History */}
            {syncHistory && syncHistory.length > 0 && (
              <Card shadow="sm" padding="lg" radius="md" withBorder>
                <Text size="sm" fw={500} mb="md">Recent Sync History</Text>
                
                <Stack gap="sm">
                  {syncHistory.slice(0, 5).map((sync, index) => (
                    <div 
                      key={sync.syncId}
                      style={{ 
                        padding: '12px', 
                        border: '1px solid var(--mantine-color-gray-3)', 
                        borderRadius: '8px',
                        backgroundColor: index === 0 ? 'var(--mantine-color-gray-0)' : 'transparent'
                      }}
                    >
                      <Group justify="space-between" mb="xs">
                        <div>
                          <Text size="sm" fw={500} c={getSyncStatusColor(sync.status)}>
                            {sync.status.toUpperCase()}
                          </Text>
                          <Text size="xs" c="dimmed">{formatDate(sync.startTime)}</Text>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <Text size="sm">
                            {sync.stats.successfulSpaces}/{sync.stats.totalSpaces} spaces
                          </Text>
                          <Text size="xs" c="dimmed">
                            {formatDuration(sync.duration)}
                          </Text>
                        </div>
                      </Group>
                      
                      <Group gap="xs">
                        <Text size="xs" c="dimmed">
                          {sync.stats.successfulPages} pages synced
                        </Text>
                        {sync.stats.errors.length > 0 && (
                          <>
                            <Text size="xs" c="dimmed">•</Text>
                            <Text size="xs" c="red">
                              {sync.stats.errors.length} errors
                            </Text>
                          </>
                        )}
                      </Group>
                      
                      {sync.stats.errors.length > 0 && index < 2 && (
                        <Text size="xs" c="dimmed" mt="xs">
                          Latest error: {sync.stats.errors[0]}
                        </Text>
                      )}
                    </div>
                  ))}
                </Stack>
              </Card>
            )}

            {/* Auto-Sync Status */}
            {config?.autoSync?.enabled && (
              <Card shadow="sm" padding="lg" radius="md" withBorder>
                <Text size="sm" fw={500} mb="md">Auto-Sync Status</Text>
                
                <Group>
                  <div>
                    <Text size="sm" fw={500} c="green">Enabled</Text>
                    <Text size="xs" c="dimmed">
                      Interval: {config.autoSync.interval}
                    </Text>
                  </div>
                </Group>
                
                <Text size="xs" c="dimmed" mt="sm">
                  Next sync will occur based on the configured interval. Manual sync is available anytime.
                </Text>
              </Card>
            )}
          </Stack>
        </>
      )}
    </>
  );
}