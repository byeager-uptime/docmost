export interface NavigationLink {
  label: string;
  url: string;
  external?: boolean;
}

export interface BrandingConfig {
  logo?: string;
  siteName?: string;
  hideSiteName?: boolean;
  navigationLinks?: NavigationLink[];
  showDocmostBranding?: boolean;
}

export interface BrandingValidation {
  valid: boolean;
  errors: string[];
}