import React, { useState } from "react";
import { Modal, Text, Button, Group, Checkbox, Progress, Stack, Alert, Card, Title, Divider, Badge } from "@mantine/core";
import { IconFileText, IconBulb, IconAlertTriangle, IconCheck, IconX } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { notifications } from "@mantine/notifications";
import { useExportToDocusaurus } from "@/features/workspace/queries/docusaurus.query";
import { isCloud } from "@/lib/config";

interface BatchPublishItem {
  id: string;
  title: string;
  type: "page" | "space";
  selected: boolean;
  status: "pending" | "publishing" | "completed" | "failed";
  error?: string;
}

interface DocusaurusBatchPublishModalProps {
  opened: boolean;
  onClose: () => void;
  items: Array<{
    id: string;
    title: string;
    type: "page" | "space";
  }>;
}

export default function DocusaurusBatchPublishModal({
  opened,
  onClose,
  items
}: DocusaurusBatchPublishModalProps) {
  const { t } = useTranslation();
  const exportMutation = useExportToDocusaurus();
  
  const [batchItems, setBatchItems] = useState<BatchPublishItem[]>(
    items.map(item => ({
      ...item,
      selected: false,
      status: "pending"
    }))
  );
  
  const [isPublishing, setIsPublishing] = useState(false);
  const [currentProgress, setCurrentProgress] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);

  // Don't show in cloud environment
  if (isCloud()) {
    return null;
  }

  const selectedItems = batchItems.filter(item => item.selected);
  const canPublish = selectedItems.length > 0 && !isPublishing;

  const toggleItemSelection = (itemId: string) => {
    setBatchItems(prev => prev.map(item => 
      item.id === itemId 
        ? { ...item, selected: !item.selected }
        : item
    ));
  };

  const toggleSelectAll = () => {
    const allSelected = batchItems.every(item => item.selected);
    setBatchItems(prev => prev.map(item => ({
      ...item,
      selected: !allSelected
    })));
  };

  const resetBatch = () => {
    setBatchItems(prev => prev.map(item => ({
      ...item,
      status: "pending",
      error: undefined
    })));
    setCurrentProgress(0);
    setCompletedCount(0);
    setIsPublishing(false);
  };

  const updateItemStatus = (itemId: string, status: BatchPublishItem["status"], error?: string) => {
    setBatchItems(prev => prev.map(item => 
      item.id === itemId 
        ? { ...item, status, error }
        : item
    ));
  };

  const startBatchPublish = async () => {
    if (!canPublish) return;

    setIsPublishing(true);
    setCurrentProgress(0);
    setCompletedCount(0);

    const selected = selectedItems;
    let completed = 0;

    for (let i = 0; i < selected.length; i++) {
      const item = selected[i];
      updateItemStatus(item.id, "publishing");

      try {
        await exportMutation.mutateAsync({
          contentId: item.id,
          contentType: item.type,
          options: { 
            includeChildren: true, 
            includeAttachments: false 
          }
        });

        updateItemStatus(item.id, "completed");
        completed++;
        setCompletedCount(completed);
        
        notifications.show({
          message: `Successfully published ${item.type}: ${item.title}`,
          color: "green",
          icon: <IconCheck size={16} />
        });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Unknown error";
        updateItemStatus(item.id, "failed", errorMessage);
        
        notifications.show({
          message: `Failed to publish ${item.type}: ${item.title}`,
          color: "red",
          icon: <IconX size={16} />
        });
      }

      setCurrentProgress(((i + 1) / selected.length) * 100);
    }

    setIsPublishing(false);
    
    const failedCount = selected.length - completed;
    
    if (failedCount === 0) {
      notifications.show({
        message: `Successfully published all ${completed} items to Docusaurus`,
        color: "green",
        icon: <IconCheck size={16} />
      });
    } else {
      notifications.show({
        message: `Batch publish completed: ${completed} succeeded, ${failedCount} failed`,
        color: failedCount > completed ? "red" : "yellow",
        icon: <IconAlertTriangle size={16} />
      });
    }
  };

  const handleClose = () => {
    if (isPublishing) {
      return; // Prevent closing during publishing
    }
    resetBatch();
    onClose();
  };

  const getStatusIcon = (status: BatchPublishItem["status"]) => {
    switch (status) {
      case "publishing":
        return <IconBulb size={16} color="blue" />;
      case "completed":
        return <IconCheck size={16} color="green" />;
      case "failed":
        return <IconX size={16} color="red" />;
      default:
        return <IconFileText size={16} />;
    }
  };

  const getStatusBadge = (status: BatchPublishItem["status"]) => {
    switch (status) {
      case "publishing":
        return <Badge color="blue" variant="light">Publishing...</Badge>;
      case "completed":
        return <Badge color="green" variant="light">Completed</Badge>;
      case "failed":
        return <Badge color="red" variant="light">Failed</Badge>;
      default:
        return null;
    }
  };

  return (
    <Modal
      opened={opened}
      onClose={handleClose}
      title={
        <Group>
          <IconFileText size={20} />
          <Text fw={600}>Batch Publish to Docusaurus</Text>
        </Group>
      }
      size="lg"
      centered
      closeOnClickOutside={!isPublishing}
      closeOnEscape={!isPublishing}
      withCloseButton={!isPublishing}
    >
      <Stack gap="md">
        <Alert icon={<IconBulb size={16} />} title="Batch Publishing" color="blue">
          Select multiple pages or spaces to publish to Docusaurus in one operation. 
          This will export each item with their configured category mappings.
        </Alert>

        {/* Progress Section */}
        {isPublishing && (
          <Card withBorder>
            <Stack gap="sm">
              <Group justify="space-between">
                <Text size="sm" fw={500}>Publishing Progress</Text>
                <Text size="sm" c="dimmed">
                  {completedCount} / {selectedItems.length} completed
                </Text>
              </Group>
              <Progress value={currentProgress} animated />
            </Stack>
          </Card>
        )}

        {/* Batch Controls */}
        <Group justify="space-between">
          <Group>
            <Checkbox
              label="Select All"
              checked={batchItems.length > 0 && batchItems.every(item => item.selected)}
              indeterminate={batchItems.some(item => item.selected) && !batchItems.every(item => item.selected)}
              onChange={toggleSelectAll}
              disabled={isPublishing}
            />
            <Text size="sm" c="dimmed">
              {selectedItems.length} of {batchItems.length} selected
            </Text>
          </Group>
          
          {completedCount > 0 && !isPublishing && (
            <Button size="xs" variant="light" onClick={resetBatch}>
              Reset Status
            </Button>
          )}
        </Group>

        <Divider />

        {/* Items List */}
        <Stack gap="xs" mah={300} style={{ overflowY: "auto" }}>
          {batchItems.map((item) => (
            <Card key={item.id} withBorder padding="sm">
              <Group justify="space-between" align="flex-start">
                <Group align="flex-start" gap="sm">
                  <Checkbox
                    checked={item.selected}
                    onChange={() => toggleItemSelection(item.id)}
                    disabled={isPublishing}
                    mt={2}
                  />
                  <Stack gap={4} style={{ flex: 1 }}>
                    <Group gap="xs">
                      {getStatusIcon(item.status)}
                      <Text size="sm" fw={500} lineClamp={1}>
                        {item.title}
                      </Text>
                      <Badge size="xs" variant="outline">
                        {item.type}
                      </Badge>
                    </Group>
                    {item.error && (
                      <Text size="xs" c="red" lineClamp={2}>
                        Error: {item.error}
                      </Text>
                    )}
                  </Stack>
                </Group>
                {getStatusBadge(item.status)}
              </Group>
            </Card>
          ))}
        </Stack>

        {batchItems.length === 0 && (
          <Alert icon={<IconAlertTriangle size={16} />} color="yellow">
            No items available for batch publishing.
          </Alert>
        )}

        {/* Action Buttons */}
        <Group justify="flex-end" mt="md">
          <Button
            variant="default"
            onClick={handleClose}
            disabled={isPublishing}
          >
            {isPublishing ? "Publishing..." : "Cancel"}
          </Button>
          <Button
            onClick={startBatchPublish}
            loading={isPublishing}
            disabled={!canPublish}
            leftSection={<IconFileText size={16} />}
          >
            {isPublishing 
              ? `Publishing ${completedCount + 1} of ${selectedItems.length}...` 
              : `Publish ${selectedItems.length} Selected`
            }
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}