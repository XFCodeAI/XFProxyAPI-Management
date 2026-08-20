import type { RecentRequestBucket } from '@/utils/recentRequests';

export type RuntimeObservationScope = 'provider' | 'supplier' | 'credential';
export type RuntimeObservationAdmissionScope = 'process-local' | 'home-remote' | 'unknown';
export type RuntimeObservationAvailabilityScope =
  'process-local' | 'home-remote' | 'unavailable' | 'unknown';
export type RuntimeAvailabilityState =
  | 'ready'
  | 'transient_throttled'
  | 'usage_wait'
  | 'probing'
  | 'half_open'
  | 'auth_invalid'
  | 'excluded'
  | 'disabled'
  | 'unknown';

export interface RuntimeAvailabilityCounts {
  ready: number;
  transientThrottled: number;
  usageWait: number;
  probing: number;
  halfOpen: number;
  authInvalid: number;
  excluded: number;
  disabled: number;
}

export type RuntimeConsecutive429Scope = 'credential' | 'model';

export interface RuntimeObservationConsecutive429 {
  count: number;
  threshold: number;
  scope: RuntimeConsecutive429Scope;
  model: string;
  throttled: boolean;
}

export interface RuntimeObservationResource {
  id: string;
  authIndex: string;
  scope: RuntimeObservationScope;
  parentId: string;
  provider: string;
  supplierId: string;
  name: string;
  inFlight: number;
  maximum: number;
  queued: number;
  success: number;
  failed: number;
  recentRequests: RecentRequestBucket[];
  availabilityState: RuntimeAvailabilityState;
  availabilityModel: string;
  availabilityDeadline: string;
  availabilityUpdatedAt: string;
  availabilityCounts: RuntimeAvailabilityCounts;
  healthFailureStreak: number;
  healthExcluded: boolean;
  healthExclusionCode: string;
  healthExcludedAt: string;
  consecutive429: RuntimeObservationConsecutive429 | null;
}

export interface RuntimeObservationQueue {
  waiting: number;
  maximum: number;
  closed: boolean;
}

export interface RuntimeObservationSnapshot {
  observationId: string;
  revision: number;
  observedAt: string;
  admissionScope: RuntimeObservationAdmissionScope;
  availabilityScope: RuntimeObservationAvailabilityScope;
  resources: RuntimeObservationResource[];
  queue: RuntimeObservationQueue;
  totalProviders: number;
  totalSuppliers: number;
  totalCredentials: number;
  truncated: boolean;
}

export interface RuntimeObservationEvent {
  observationId: string;
  revision: number;
  observedAt: string;
}
