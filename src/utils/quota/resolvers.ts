/**
 * Resolver functions for extracting data from auth files.
 */

import type { AuthFileItem } from '@/types';
import {
  normalizeNumberValue,
  normalizeStringValue,
  normalizePlanType,
  parseIdTokenPayload,
} from './parsers';

const toRecord = (value: unknown): Record<string, unknown> | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
};

const resolveCodexAuthInfo = (value: unknown): Record<string, unknown> | null => {
  const payload = parseIdTokenPayload(value);
  if (!payload) return null;
  const nested = toRecord(payload['https://api.openai.com/auth']);
  return nested ?? payload;
};

export function resolveCodexPlanType(file: AuthFileItem): string | null {
  const metadata =
    file && typeof file.metadata === 'object' && file.metadata !== null
      ? (file.metadata as Record<string, unknown>)
      : null;
  const attributes =
    file && typeof file.attributes === 'object' && file.attributes !== null
      ? (file.attributes as Record<string, unknown>)
      : null;
  const idToken = resolveCodexAuthInfo(file.id_token);
  const metadataIdToken = resolveCodexAuthInfo(metadata?.id_token);
  const attributesIdToken = resolveCodexAuthInfo(attributes?.id_token);
  const candidates = [
    file.plan_type,
    file.planType,
    file.chatgpt_plan_type,
    file.chatgptPlanType,
    idToken?.plan_type,
    idToken?.planType,
    idToken?.chatgpt_plan_type,
    idToken?.chatgptPlanType,
    metadata?.plan_type,
    metadata?.planType,
    metadata?.chatgpt_plan_type,
    metadata?.chatgptPlanType,
    metadataIdToken?.plan_type,
    metadataIdToken?.planType,
    metadataIdToken?.chatgpt_plan_type,
    metadataIdToken?.chatgptPlanType,
    attributes?.plan_type,
    attributes?.planType,
    attributes?.chatgpt_plan_type,
    attributes?.chatgptPlanType,
    attributesIdToken?.plan_type,
    attributesIdToken?.planType,
    attributesIdToken?.chatgpt_plan_type,
    attributesIdToken?.chatgptPlanType,
  ];

  for (const candidate of candidates) {
    const planType = normalizePlanType(candidate);
    if (planType) return planType;
  }

  return null;
}

const normalizeDateLikeValue = (value: unknown): string | number | null => {
  const numberValue = normalizeNumberValue(value);
  if (numberValue === 0) return null;
  if (numberValue !== null) return numberValue;

  const stringValue = normalizeStringValue(value);
  if (!stringValue || stringValue === '0') return null;
  return stringValue;
};

export function resolveCodexSubscriptionActiveUntil(file: AuthFileItem): string | number | null {
  const metadata = toRecord(file.metadata);
  const attributes = toRecord(file.attributes);
  const idToken = resolveCodexAuthInfo(file.id_token);
  const metadataIdToken = resolveCodexAuthInfo(metadata?.id_token);
  const attributesIdToken = resolveCodexAuthInfo(attributes?.id_token);
  const subscription = toRecord(file.subscription);
  const metadataSubscription = toRecord(metadata?.subscription);
  const attributesSubscription = toRecord(attributes?.subscription);

  const candidates = [
    file.chatgpt_subscription_active_until,
    file.chatgptSubscriptionActiveUntil,
    file.subscription_active_until,
    file.subscriptionActiveUntil,
    subscription?.active_until,
    subscription?.activeUntil,
    idToken?.chatgpt_subscription_active_until,
    idToken?.chatgptSubscriptionActiveUntil,
    metadata?.chatgpt_subscription_active_until,
    metadata?.chatgptSubscriptionActiveUntil,
    metadata?.subscription_active_until,
    metadata?.subscriptionActiveUntil,
    metadataSubscription?.active_until,
    metadataSubscription?.activeUntil,
    metadataIdToken?.chatgpt_subscription_active_until,
    metadataIdToken?.chatgptSubscriptionActiveUntil,
    attributes?.chatgpt_subscription_active_until,
    attributes?.chatgptSubscriptionActiveUntil,
    attributes?.subscription_active_until,
    attributes?.subscriptionActiveUntil,
    attributesSubscription?.active_until,
    attributesSubscription?.activeUntil,
    attributesIdToken?.chatgpt_subscription_active_until,
    attributesIdToken?.chatgptSubscriptionActiveUntil,
  ];

  for (const candidate of candidates) {
    const value = normalizeDateLikeValue(candidate);
    if (value !== null) return value;
  }

  return null;
}
