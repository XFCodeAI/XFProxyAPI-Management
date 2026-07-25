export type SessionValidationFailureLike = {
  name: string;
  error: string;
  importable: boolean;
  proxyUrl: string;
};

export type SessionValidationResultLike = {
  files: string[];
  resolved: Array<{ name: string; proxyUrl: string }>;
  failed: SessionValidationFailureLike[];
};

export type SessionValidationMessage = {
  name: string;
  reason: string;
};

export type SessionValidationPlan = {
  candidateNames: string[];
  validatedNames: string[];
  warnings: SessionValidationMessage[];
  failures: SessionValidationMessage[];
  proxyUrls: Record<string, string>;
};

export type SessionUploadResultLike = {
  uploaded: number;
  files: string[];
  failed: Array<{ name: string; error: string }>;
};

export type SessionUploadReconciliation = {
  uploadedNames: string[];
  warnings: SessionValidationMessage[];
  failures: SessionValidationMessage[];
};

const uniqueNames = (names: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  names.forEach((value) => {
    const name = value.trim();
    if (!name || seen.has(name)) return;
    seen.add(name);
    result.push(name);
  });
  return result;
};

export function planSessionValidation(
  requestedNames: string[],
  validation: SessionValidationResultLike,
  missingResultReason: string
): SessionValidationPlan {
  const names = uniqueNames(requestedNames);
  const validated = new Set(uniqueNames(validation.files));
  const failuresByName = new Map(
    validation.failed.filter((item) => item.name.trim()).map((item) => [item.name.trim(), item])
  );
  const proxyUrls: Record<string, string> = {};
  validation.resolved.forEach((item) => {
    const name = item.name.trim();
    if (name) proxyUrls[name] = item.proxyUrl.trim();
  });

  const candidateNames: string[] = [];
  const validatedNames: string[] = [];
  const warnings: SessionValidationMessage[] = [];
  const failures: SessionValidationMessage[] = [];

  names.forEach((name) => {
    if (validated.has(name)) {
      candidateNames.push(name);
      validatedNames.push(name);
      return;
    }

    const failure = failuresByName.get(name);
    if (failure?.importable) {
      candidateNames.push(name);
      warnings.push({ name, reason: failure.error });
      if (failure.proxyUrl.trim()) proxyUrls[name] = failure.proxyUrl.trim();
      return;
    }
    if (failure) {
      failures.push({ name, reason: failure.error });
      return;
    }

    candidateNames.push(name);
    warnings.push({ name, reason: missingResultReason });
  });

  return { candidateNames, validatedNames, warnings, failures, proxyUrls };
}

export function reconcileSessionUpload(
  candidateNames: string[],
  upload: SessionUploadResultLike,
  validationWarnings: SessionValidationMessage[],
  missingResultReason: string
): SessionUploadReconciliation {
  const candidates = uniqueNames(candidateNames);
  const candidateSet = new Set(candidates);
  const explicitFailures = new Map(
    upload.failed
      .filter((item) => candidateSet.has(item.name.trim()))
      .map((item) => [item.name.trim(), item.error || 'Unknown error'])
  );

  let uploadedNames: string[];
  const returnedNames = uniqueNames(upload.files).filter((name) => candidateSet.has(name));
  if (returnedNames.length > 0) {
    uploadedNames = returnedNames;
  } else {
    const inferredCount = Math.min(
      Math.max(0, Math.floor(upload.uploaded)),
      candidates.length - explicitFailures.size
    );
    uploadedNames = candidates
      .filter((name) => !explicitFailures.has(name))
      .slice(0, inferredCount);
  }

  const uploadedSet = new Set(uploadedNames);
  const failures: SessionValidationMessage[] = [];
  candidates.forEach((name) => {
    if (uploadedSet.has(name)) return;
    failures.push({
      name,
      reason: explicitFailures.get(name) || missingResultReason,
    });
  });

  const warningByName = new Map(validationWarnings.map((warning) => [warning.name, warning]));
  const warnings = uploadedNames.flatMap((name) => {
    const warning = warningByName.get(name);
    return warning ? [warning] : [];
  });

  return { uploadedNames, warnings, failures };
}
