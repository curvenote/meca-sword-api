import { loadValidatedConfig } from '@app-config/config';
import type { Collection } from '@curvenote/sword-server';

/** Mirrors `.app-config.schema.yml` */
export type AppConfig = {
  title: string;
  /** No trailing slash; `PUBLIC_URL` overrides the configured value */
  publicUrl: string;
  admins?: string[];
  collections?: Collection[];
  maxUploadSize?: number;
  storage?: { bucket?: string; directory?: string };
  database: { url: string; directUrl?: string };
  session: { secret: string };
  encryptionKey: string;
  auth?: {
    google?: OAuthClientConfig;
    github?: OAuthClientConfig;
    devLogin?: boolean;
  };
};

export type OAuthClientConfig = { clientId: string; clientSecret: string };

let loading: Promise<AppConfig> | undefined;

/**
 * Configuration from app-config: `.app-config.yml` plus the secrets file in development, the
 * `APP_CONFIG` environment variable (JSON) when deployed.
 */
export function getConfig(): Promise<AppConfig> {
  loading ??= loadValidatedConfig().then(({ fullConfig }) => {
    const config = fullConfig as unknown as AppConfig;
    return {
      ...config,
      publicUrl: (process.env.PUBLIC_URL || config.publicUrl).replace(/\/+$/, ''),
    };
  });
  return loading;
}

/** Override the configuration, for tests */
export function setConfig(config: AppConfig) {
  loading = Promise.resolve(config);
}

export const isProduction = () => process.env.NODE_ENV === 'production';
