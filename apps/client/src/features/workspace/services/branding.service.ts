import api from "@/lib/api-client.ts";
import { BrandingConfig } from "../types/branding.types";

export class BrandingService {
  static async getBrandingConfig(): Promise<BrandingConfig> {
    const response = await api.post('/workspace/branding/config');
    console.log('Raw API response:', response);
    
    // Handle different response formats
    if (response && typeof response === 'object') {
      // If response has a 'data' property, use that
      if ('data' in response) {
        return (response as any).data;
      }
      // Otherwise, assume the response is the data itself
      return response as BrandingConfig;
    }
    
    return response;
  }

  static async updateBrandingConfig(config: BrandingConfig): Promise<BrandingConfig> {
    const response = await api.post('/workspace/branding/config/update', config);
    console.log('Update response:', response);
    
    // Handle different response formats
    if (response && typeof response === 'object') {
      // If response has a 'data' property, use that
      if ('data' in response) {
        return (response as any).data;
      }
      // Otherwise, assume the response is the data itself
      return response as BrandingConfig;
    }
    
    return response;
  }

  static async uploadLogo(file: File): Promise<string> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('type', 'workspace-logo');
    
    const response = await api.post('/attachments/upload-image', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
    });
    
    return (response as any).url || (response as any).filePath;
  }
}