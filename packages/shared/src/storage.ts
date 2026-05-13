import type { CloudStorageProvider } from "./image.js";
import type { MaskedSecret } from "./provider-config.js";

export interface CosStorageConfigView {
  secretId: string;
  secretKey: MaskedSecret;
  bucket: string;
  region: string;
  keyPrefix: string;
}

export interface StorageConfigResponse {
  enabled: boolean;
  provider: CloudStorageProvider;
  cos: CosStorageConfigView;
}

export interface SaveCosStorageConfig {
  secretId: string;
  secretKey?: string;
  preserveSecret?: boolean;
  bucket: string;
  region: string;
  keyPrefix: string;
}

export interface SaveStorageConfigRequest {
  enabled: boolean;
  provider: CloudStorageProvider;
  cos?: SaveCosStorageConfig;
}

export interface StorageTestResult {
  ok: boolean;
  message: string;
}
