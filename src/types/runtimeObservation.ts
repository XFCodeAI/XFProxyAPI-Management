import type { RecentRequestBucket } from '@/utils/recentRequests';

export type RuntimeObservationScope = 'provider' | 'supplier' | 'credential';
export type RuntimeObservationAdmissionScope = 'process-local' | 'home-remote' | 'unknown';

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
