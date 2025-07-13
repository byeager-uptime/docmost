import React, { useState } from "react";
import { Button, Menu, ActionIcon, Tooltip } from "@mantine/core";
import { IconFileExport, IconChevronDown, IconBulb } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { useDisclosure } from "@mantine/hooks";
import DocusaurusBatchPublishModal from "./docusaurus-batch-publish-modal";
import { isCloud } from "@/lib/config";

interface DocusaurusBatchPublishButtonProps {
  items: Array<{
    id: string;
    title: string;
    type: "page" | "space";
  }>;
  variant?: "button" | "menu-item" | "action-icon";
  disabled?: boolean;
  size?: "xs" | "sm" | "md" | "lg";
}

export default function DocusaurusBatchPublishButton({
  items,
  variant = "button",
  disabled = false,
  size = "sm"
}: DocusaurusBatchPublishButtonProps) {
  const { t } = useTranslation();
  const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure(false);

  // Don't show in cloud environment
  if (isCloud()) {
    return null;
  }

  const canPublish = items.length > 0 && !disabled;
  const buttonText = `Batch Publish ${items.length} Items`;

  if (variant === "menu-item") {
    return (
      <>
        <Menu.Item
          leftSection={<IconFileExport size={16} />}
          onClick={openModal}
          disabled={!canPublish}
        >
          {buttonText}
        </Menu.Item>
        <DocusaurusBatchPublishModal
          opened={modalOpened}
          onClose={closeModal}
          items={items}
        />
      </>
    );
  }

  if (variant === "action-icon") {
    return (
      <>
        <Tooltip label={buttonText} openDelay={250} withArrow>
          <ActionIcon
            variant="default"
            size={size}
            onClick={openModal}
            disabled={!canPublish}
          >
            <IconFileExport size={16} />
          </ActionIcon>
        </Tooltip>
        <DocusaurusBatchPublishModal
          opened={modalOpened}
          onClose={closeModal}
          items={items}
        />
      </>
    );
  }

  return (
    <>
      <Button
        leftSection={<IconFileExport size={16} />}
        variant="light"
        size={size}
        onClick={openModal}
        disabled={!canPublish}
      >
        {buttonText}
      </Button>
      <DocusaurusBatchPublishModal
        opened={modalOpened}
        onClose={closeModal}
        items={items}
      />
    </>
  );
}

// Enhanced batch publish button with dropdown for different operations
export function DocusaurusBatchPublishDropdown({
  items,
  disabled = false,
  size = "sm"
}: Omit<DocusaurusBatchPublishButtonProps, "variant">) {
  const { t } = useTranslation();
  const [modalOpened, { open: openModal, close: closeModal }] = useDisclosure(false);

  if (isCloud()) {
    return null;
  }

  const canPublish = items.length > 0 && !disabled;

  return (
    <>
      <Menu shadow="md" width={200}>
        <Menu.Target>
          <Button
            leftSection={<IconBulb size={16} />}
            rightSection={<IconChevronDown size={14} />}
            variant="light"
            size={size}
            disabled={!canPublish}
          >
            Batch Operations
          </Button>
        </Menu.Target>

        <Menu.Dropdown>
          <Menu.Label>Docusaurus Operations</Menu.Label>
          <Menu.Item
            leftSection={<IconFileExport size={16} />}
            onClick={openModal}
            disabled={!canPublish}
          >
            Batch Publish ({items.length} items)
          </Menu.Item>
          
          <Menu.Divider />
          
          <Menu.Label>Coming Soon</Menu.Label>
          <Menu.Item
            leftSection={<IconBulb size={16} />}
            disabled
            c="dimmed"
          >
            Bulk Preview
          </Menu.Item>
          <Menu.Item
            leftSection={<IconBulb size={16} />}
            disabled
            c="dimmed"
          >
            Schedule Publish
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>

      <DocusaurusBatchPublishModal
        opened={modalOpened}
        onClose={closeModal}
        items={items}
      />
    </>
  );
}