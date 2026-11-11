export type PlatformServiceId = 'geonode' | 'dagster' | 'keycloak';
export type ServiceStatus = 'up' | 'down' | 'unconfigured';

export interface PlatformService {
  id: PlatformServiceId;
  label: string;
  /** null: the API has no address for this service. */
  url: string | null;
  status: ServiceStatus;
  checkedAt: string;
}
