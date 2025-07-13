import React, { useState } from 'react';
import {
  Box,
  Card,
  Title,
  Text,
  Stack,
  Group,
  Button,
  TextInput,
  Switch,
  ActionIcon,
  FileInput,
  Avatar,
  Alert,
  Divider,
} from '@mantine/core';
import { IconTrash, IconPlus, IconUpload, IconExternalLink } from '@tabler/icons-react';
import { useBrandingConfig, useUpdateBrandingConfig, useUploadLogo } from '../hooks/use-branding';
import { BrandingConfig, NavigationLink } from '../types/branding.types';
import { notifications } from '@mantine/notifications';

export default function WorkspaceBrandingSettings() {
  const { data: brandingConfig, isLoading } = useBrandingConfig();
  const updateBrandingMutation = useUpdateBrandingConfig();
  const uploadLogoMutation = useUploadLogo();
  
  const [formData, setFormData] = useState<BrandingConfig>({
    logo: '',
    siteName: '',
    hideSiteName: false,
    navigationLinks: [],
    showDocmostBranding: true,
  });
  const [logoFile, setLogoFile] = useState<File | null>(null);

  React.useEffect(() => {
    if (brandingConfig) {
      setFormData(brandingConfig);
    }
  }, [brandingConfig]);

  const handleSave = async () => {
    try {
      let logoUrl = formData.logo;
      
      if (logoFile) {
        logoUrl = await uploadLogoMutation.mutateAsync(logoFile);
      }

      await updateBrandingMutation.mutateAsync({
        ...formData,
        logo: logoUrl,
      });
      
      setLogoFile(null);
    } catch (error) {
      console.error('Failed to save branding settings:', error);
    }
  };

  const addNavigationLink = () => {
    setFormData(prev => ({
      ...prev,
      navigationLinks: [
        ...(prev.navigationLinks || []),
        { label: '', url: '', external: true }
      ]
    }));
  };

  const updateNavigationLink = (index: number, field: keyof NavigationLink, value: string | boolean) => {
    setFormData(prev => ({
      ...prev,
      navigationLinks: prev.navigationLinks?.map((link, i) => 
        i === index ? { ...link, [field]: value } : link
      ) || []
    }));
  };

  const removeNavigationLink = (index: number) => {
    setFormData(prev => ({
      ...prev,
      navigationLinks: prev.navigationLinks?.filter((_, i) => i !== index) || []
    }));
  };

  if (isLoading) return <div>Loading...</div>;

  return (
    <Box>
      <Title size="h3" mb="md">Branding</Title>
      <Text size="sm" c="dimmed" mb="xl">
        Customize the appearance of your Docmost workspace and Docusaurus documentation site.
      </Text>

      <Stack gap="xl">
        {/* Logo Section */}
        <Card withBorder p="md">
          <Title size="h4" mb="md">Logo</Title>
          <Text size="sm" c="dimmed" mb="md">
            Upload a logo to replace the default Docmost branding in both the workspace and documentation site.
          </Text>
          
          <Group align="start" gap="md">
            {formData.logo && (
              <Avatar
                src={formData.logo}
                size="lg"
                radius="sm"
              />
            )}
            
            <Stack gap="xs" style={{ flex: 1 }}>
              <FileInput
                label="Upload Logo"
                placeholder="Select logo file"
                accept="image/*"
                value={logoFile}
                onChange={setLogoFile}
                leftSection={<IconUpload size={16} />}
              />
              
              {formData.logo && (
                <TextInput
                  label="Current Logo URL"
                  value={formData.logo}
                  onChange={(e) => setFormData(prev => ({ ...prev, logo: e.target.value }))}
                  placeholder="https://example.com/logo.png"
                />
              )}
            </Stack>
          </Group>
        </Card>

        {/* Site Name Section */}
        <Card withBorder p="md">
          <Title size="h4" mb="md">Site Name</Title>
          <Text size="sm" c="dimmed" mb="md">
            Customize the site name displayed in the header.
          </Text>
          
          <Stack gap="md">
            <TextInput
              label="Site Name"
              value={formData.siteName || ''}
              onChange={(e) => setFormData(prev => ({ ...prev, siteName: e.target.value }))}
              placeholder="My Documentation Site"
            />
            
            <Switch
              label="Hide site name when logo is present"
              description="Show only the logo without the site name text (useful when logo includes company name)"
              checked={formData.hideSiteName || false}
              onChange={(e) => setFormData(prev => ({ ...prev, hideSiteName: e.target.checked }))}
              disabled={!formData.logo}
            />
          </Stack>
        </Card>

        {/* Navigation Links Section */}
        <Card withBorder p="md">
          <Group justify="space-between" align="center" mb="md">
            <div>
              <Title size="h4">Navigation Links</Title>
              <Text size="sm" c="dimmed">
                Add custom navigation links to the header (e.g., Docs, Website, GitHub).
              </Text>
            </div>
            <Button
              leftSection={<IconPlus size={16} />}
              variant="light"
              onClick={addNavigationLink}
            >
              Add Link
            </Button>
          </Group>

          {formData.navigationLinks && formData.navigationLinks.length > 0 ? (
            <Stack gap="md">
              {formData.navigationLinks.map((link, index) => (
                <Group key={index} align="end" gap="md">
                  <TextInput
                    label="Label"
                    value={link.label}
                    onChange={(e) => updateNavigationLink(index, 'label', e.target.value)}
                    placeholder="Docs"
                    style={{ flex: 1 }}
                  />
                  
                  <TextInput
                    label="URL"
                    value={link.url}
                    onChange={(e) => updateNavigationLink(index, 'url', e.target.value)}
                    placeholder="https://github.com/myorg/myrepo"
                    style={{ flex: 2 }}
                    rightSection={link.external && <IconExternalLink size={16} />}
                  />
                  
                  <Switch
                    label="External"
                    checked={link.external || false}
                    onChange={(e) => updateNavigationLink(index, 'external', e.target.checked)}
                  />
                  
                  <ActionIcon
                    color="red"
                    variant="light"
                    onClick={() => removeNavigationLink(index)}
                  >
                    <IconTrash size={16} />
                  </ActionIcon>
                </Group>
              ))}
            </Stack>
          ) : (
            <Alert variant="light" color="blue">
              No navigation links configured. Click "Add Link" to get started.
            </Alert>
          )}
        </Card>

        {/* Docmost Branding Section */}
        <Card withBorder p="md">
          <Title size="h4" mb="md">Docmost Branding</Title>
          <Text size="sm" c="dimmed" mb="md">
            Control whether to show "Powered by Docmost" branding.
          </Text>
          
          <Switch
            label="Show Docmost Branding"
            description="Display 'Powered by Docmost' in the footer"
            checked={formData.showDocmostBranding || false}
            onChange={(e) => setFormData(prev => ({ ...prev, showDocmostBranding: e.target.checked }))}
          />
        </Card>

        <Divider />

        {/* Save Button */}
        <Group justify="flex-end">
          <Button
            onClick={handleSave}
            loading={updateBrandingMutation.isPending || uploadLogoMutation.isPending}
            size="md"
          >
            Save Changes
          </Button>
        </Group>
      </Stack>
    </Box>
  );
}