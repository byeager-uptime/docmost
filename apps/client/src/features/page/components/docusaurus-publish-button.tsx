import React from "react";
import { Menu, Tooltip, ActionIcon } from "@mantine/core";
import { IconFileText, IconCheck, IconX } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { notifications } from "@mantine/notifications";
import { useExportToDocusaurus } from "@/features/workspace/queries/docusaurus.query";
import { isCloud } from "@/lib/config";

interface DocusaurusPublishButtonProps {
  pageId: string;
  type?: "page" | "space";
  asMenuItem?: boolean;
  disabled?: boolean;
}

export default function DocusaurusPublishButton({ 
  pageId, 
  type = "page", 
  asMenuItem = false,
  disabled = false 
}: DocusaurusPublishButtonProps) {
  const { t } = useTranslation();
  const exportMutation = useExportToDocusaurus();

  // Don't show in cloud environment
  if (isCloud()) {
    return null;
  }

  const handlePublish = async () => {
    try {
      await exportMutation.mutateAsync({
        contentId: pageId,
        contentType: type,
        options: { includeChildren: true, includeAttachments: false }
      });
    } catch (error) {
      // Error is handled by the mutation's onError callback
      console.error("Failed to publish to Docusaurus:", error);
    }
  };

  const getButtonContent = () => {
    if (exportMutation.isPending) {
      return "Publishing...";
    }
    return `Publish ${type} to Docusaurus`;
  };

  if (asMenuItem) {
    return (
      <Menu.Item
        leftSection={<IconFileText size={16} />}
        onClick={handlePublish}
        disabled={disabled || exportMutation.isPending}
      >
        {getButtonContent()}
      </Menu.Item>
    );
  }

  return (
    <Tooltip label={getButtonContent()} openDelay={250} withArrow>
      <ActionIcon
        variant="default"
        style={{ border: "none" }}
        onClick={handlePublish}
        disabled={disabled || exportMutation.isPending}
        loading={exportMutation.isPending}
      >
        <IconFileText size={20} stroke={2} />
      </ActionIcon>
    </Tooltip>
  );
}

// Quick publish button for standalone use
export function QuickDocusaurusPublishButton({ 
  pageId, 
  type = "page" 
}: { 
  pageId: string; 
  type?: "page" | "space" 
}) {
  const { t } = useTranslation();
  const exportMutation = useExportToDocusaurus();

  if (isCloud()) {
    return null;
  }

  const handleQuickPublish = async () => {
    try {
      await exportMutation.mutateAsync({
        contentId: pageId,
        contentType: type,
        options: { includeChildren: true, includeAttachments: false }
      });
    } catch (error) {
      console.error("Failed to publish to Docusaurus:", error);
    }
  };

  return (
    <Tooltip 
      label={`Quick publish ${type} to Docusaurus`} 
      openDelay={250} 
      withArrow
    >
      <ActionIcon
        variant="light"
        color="blue"
        size="sm"
        onClick={handleQuickPublish}
        loading={exportMutation.isPending}
        disabled={exportMutation.isPending}
      >
        <IconFileText size={16} stroke={2} />
      </ActionIcon>
    </Tooltip>
  );
}