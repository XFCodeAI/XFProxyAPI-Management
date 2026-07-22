import { normalizeCredentialGroups } from '../../utils/credentialGroups.ts';

export interface AuthFilesGroupAssignmentTarget {
  name: string;
}

export interface AuthFilesGroupAssignmentFailure<T extends AuthFilesGroupAssignmentTarget> {
  target: T;
  error: unknown;
}

export interface AuthFilesGroupAssignmentResult<T extends AuthFilesGroupAssignmentTarget> {
  groups: string[];
  successCount: number;
  failed: AuthFilesGroupAssignmentFailure<T>[];
}

export async function applyAuthFilesGroupAssignment<T extends AuthFilesGroupAssignmentTarget>(
  targets: readonly T[],
  groups: readonly string[],
  patch: (target: T, groups: string[]) => Promise<unknown>
): Promise<AuthFilesGroupAssignmentResult<T>> {
  const normalizedGroups = normalizeCredentialGroups(groups);
  const results = await Promise.allSettled(
    targets.map((target) => patch(target, normalizedGroups))
  );
  const failed = results.flatMap((result, index) =>
    result.status === 'rejected' ? [{ target: targets[index], error: result.reason }] : []
  );

  return {
    groups: normalizedGroups,
    successCount: targets.length - failed.length,
    failed,
  };
}
