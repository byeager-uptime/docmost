import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BrandingService } from "../services/branding.service";
import { BrandingConfig } from "../types/branding.types";
import { notifications } from "@mantine/notifications";

export function useBrandingConfig() {
  return useQuery({
    queryKey: ['branding-config'],
    queryFn: async () => {
      const config = await BrandingService.getBrandingConfig();
      console.log('Fetched branding config:', config);
      return config;
    },
  });
}

export function useUpdateBrandingConfig() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (config: BrandingConfig) => {
      console.log('Updating branding config:', config);
      const result = await BrandingService.updateBrandingConfig(config);
      console.log('Update result:', result);
      return result;
    },
    onSuccess: (data) => {
      console.log('Update success, data:', data);
      queryClient.invalidateQueries({ queryKey: ['branding-config'] });
      notifications.show({
        title: 'Success',
        message: 'Branding configuration updated successfully',
        color: 'green',
      });
    },
    onError: (error: any) => {
      console.error('Update error:', error);
      notifications.show({
        title: 'Error',
        message: error?.response?.data?.message || 'Failed to update branding configuration',
        color: 'red',
      });
    },
  });
}

export function useUploadLogo() {
  return useMutation({
    mutationFn: (file: File) => BrandingService.uploadLogo(file),
    onError: (error: any) => {
      notifications.show({
        title: 'Error',
        message: error?.response?.data?.message || 'Failed to upload logo',
        color: 'red',
      });
    },
  });
}