type JsonRecord = Record<string, unknown>;

export interface GptSessionCpaAuth extends JsonRecord {
  type: 'codex';
  account_id?: string;
  chatgpt_account_id?: string;
  email?: string;
  name?: string;
  plan_type?: string;
  chatgpt_plan_type?: string;
  id_token?: string;
  id_token_synthetic?: true;
  access_token: string;
  refresh_token: string;
  session_token?: string;
  last_refresh?: string;
  expired?: string;
  disabled?: true;
}

export interface GptSessionImportRecord {
  sourceName: string;
  sourcePath: string;
  email?: string;
  name: string;
  accountId?: string;
  planType?: string;
  expiresAt?: string;
  hasRefreshToken: boolean;
  syntheticIdToken: boolean;
  cpa: GptSessionCpaAuth;
  fileName: string;
}

export interface GptSessionImportIssue {
  sourceName: string;
  path: string;
  reason: string;
}

export interface GptSessionImportResult {
  records: GptSessionImportRecord[];
  issues: GptSessionImportIssue[];
  missingRefreshTokenCount: number;
  syntheticIdTokenCount: number;
}

export interface GptSessionConsumeResult extends GptSessionImportResult {
  remainingText: string;
}

export interface GptSessionCpaFileSpec {
  fileName: string;
  content: string;
}

interface SessionSource {
  value: JsonRecord;
  sourceName: string;
  path: string;
}

interface ConvertOptions {
  now?: Date;
  sourceName?: string;
  sourcePath?: string;
}

const DEFAULT_SOURCE_NAME = 'pasted-json';

const isRecord = (value: unknown): value is JsonRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const getRecord = (record: JsonRecord, key: string): JsonRecord | undefined => {
  const value = record[key];
  return isRecord(value) ? value : undefined;
};

const firstNonEmpty = (...values: unknown[]): string | undefined => {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') {
      return value.trim();
    }
  }
  return undefined;
};

const decodeBase64Url = (value: string): string => {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
};

const bytesToBase64Url = (bytes: Uint8Array): string => {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const encodeBase64UrlJson = (value: JsonRecord): string =>
  bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));

const parseJwtPayload = (token: unknown): JsonRecord | undefined => {
  if (typeof token !== 'string' || token.trim() === '') {
    return undefined;
  }

  const segments = token.split('.');
  if (segments.length < 2) {
    return undefined;
  }

  try {
    const payload = JSON.parse(decodeBase64Url(segments[1])) as unknown;
    return isRecord(payload) ? payload : undefined;
  } catch {
    return undefined;
  }
};

const getOpenAIAuthSection = (payload?: JsonRecord): JsonRecord =>
  payload ? (getRecord(payload, 'https://api.openai.com/auth') ?? {}) : {};

const getOpenAIProfileSection = (payload?: JsonRecord): JsonRecord =>
  payload ? (getRecord(payload, 'https://api.openai.com/profile') ?? {}) : {};

const normalizeTimestamp = (value: unknown): string | undefined => {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    const milliseconds = value > 1e11 ? value : value * 1000;
    const date = new Date(milliseconds);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  }

  if (typeof value !== 'string' || value.trim() === '') {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

const timestampFromUnixSeconds = (value: unknown): string | undefined => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return undefined;
  }

  const date = new Date(numeric * 1000);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
};

const epochSecondsFromValue = (value: unknown): number => {
  if (value === undefined || value === null || value === '') {
    return 0;
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric)) {
    return Math.trunc(numeric > 1e11 ? numeric / 1000 : numeric);
  }

  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? Math.trunc(parsed / 1000) : 0;
};

const buildSyntheticCodexIdToken = (
  email: string | undefined,
  accountId: string | undefined,
  planType: string | undefined,
  userId: string | undefined,
  expiresAt: string | undefined,
  now: Date
): string | undefined => {
  if (!accountId) {
    return undefined;
  }

  const issuedAt = Math.trunc(now.getTime() / 1000);
  const authInfo: JsonRecord = { chatgpt_account_id: accountId };
  const expires = epochSecondsFromValue(expiresAt) || issuedAt + 90 * 24 * 60 * 60;

  if (planType) {
    authInfo.chatgpt_plan_type = planType;
  }
  if (userId) {
    authInfo.chatgpt_user_id = userId;
    authInfo.user_id = userId;
  }

  const payload: JsonRecord = {
    iat: issuedAt,
    exp: expires,
    'https://api.openai.com/auth': authInfo,
  };
  if (email) {
    payload.email = email;
  }

  return `${encodeBase64UrlJson({ alg: 'none', typ: 'JWT', cpa_synthetic: true })}.${encodeBase64UrlJson(payload)}.synthetic`;
};

const compactAuth = (value: JsonRecord): GptSessionCpaAuth => {
  const entries = Object.entries(value).filter(([, item]) => item !== undefined && item !== null);
  return Object.fromEntries(entries) as GptSessionCpaAuth;
};

const sanitizeFileToken = (value: string | undefined, fallback: string): string => {
  const base = firstNonEmpty(value, fallback) ?? fallback;
  const normalized = base
    .replace(/\.[^.]+$/u, '')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
    .slice(0, 80);
  return normalized || fallback;
};

const buildCpaFileName = (
  name: string,
  email: string | undefined,
  planType: string | undefined
): string => {
  const base = sanitizeFileToken(email || name, 'gpt-session');
  const plan = sanitizeFileToken(planType, '');
  return `codex-${base}${plan ? `-${plan}` : ''}.json`;
};

const readAccessToken = (record: JsonRecord): string | undefined => {
  const tokens = getRecord(record, 'tokens');
  const token = getRecord(record, 'token');
  const credentials = getRecord(record, 'credentials');
  return firstNonEmpty(
    record.accessToken,
    record.access_token,
    tokens?.accessToken,
    tokens?.access_token,
    token?.accessToken,
    token?.access_token,
    credentials?.accessToken,
    credentials?.access_token
  );
};

const readSessionToken = (record: JsonRecord): string | undefined => {
  const tokens = getRecord(record, 'tokens');
  const token = getRecord(record, 'token');
  const credentials = getRecord(record, 'credentials');
  return firstNonEmpty(
    record.sessionToken,
    record.session_token,
    tokens?.sessionToken,
    tokens?.session_token,
    token?.sessionToken,
    token?.session_token,
    credentials?.sessionToken,
    credentials?.session_token
  );
};

const readRefreshToken = (record: JsonRecord): string | undefined => {
  const tokens = getRecord(record, 'tokens');
  const token = getRecord(record, 'token');
  const credentials = getRecord(record, 'credentials');
  return firstNonEmpty(
    record.refreshToken,
    record.refresh_token,
    tokens?.refreshToken,
    tokens?.refresh_token,
    token?.refreshToken,
    token?.refresh_token,
    credentials?.refreshToken,
    credentials?.refresh_token
  );
};

const readIdToken = (record: JsonRecord): string | undefined => {
  const tokens = getRecord(record, 'tokens');
  const token = getRecord(record, 'token');
  const credentials = getRecord(record, 'credentials');
  return firstNonEmpty(
    record.idToken,
    record.id_token,
    tokens?.idToken,
    tokens?.id_token,
    token?.idToken,
    token?.id_token,
    credentials?.idToken,
    credentials?.id_token
  );
};

const hasSessionIdentity = (record: JsonRecord): boolean => {
  const tokens = getRecord(record, 'tokens');
  const providerData = getRecord(record, 'providerSpecificData');
  return Boolean(
    getRecord(record, 'user') ||
    firstNonEmpty(
      record.email,
      record.name,
      record.label,
      getRecord(record, 'meta')?.label,
      tokens?.accountId,
      tokens?.account_id,
      tokens?.chatgptAccountId,
      tokens?.chatgpt_account_id,
      providerData?.chatgptAccountId,
      providerData?.chatgpt_account_id,
      record.id
    )
  );
};

export function collectGptSessionSources(
  value: unknown,
  sourceName = DEFAULT_SOURCE_NAME
): SessionSource[] {
  const found: SessionSource[] = [];
  const visited = new WeakSet<object>();

  const visit = (item: unknown, path: string) => {
    if (Array.isArray(item)) {
      if (visited.has(item)) return;
      visited.add(item);
      item.forEach((child, index) => visit(child, `${path}[${index}]`));
      return;
    }

    if (!isRecord(item)) {
      return;
    }
    if (visited.has(item)) {
      return;
    }
    visited.add(item);

    if (readAccessToken(item) && hasSessionIdentity(item)) {
      found.push({ value: item, sourceName, path });
      return;
    }

    Object.entries(item).forEach(([key, child]) => {
      if (
        key === 'accessToken' ||
        key === 'access_token' ||
        key === 'sessionToken' ||
        key === 'session_token'
      ) {
        return;
      }
      visit(child, `${path}.${key}`);
    });
  };

  visit(value, '$');
  return found;
}

export function convertGptSessionToCpa(
  record: JsonRecord,
  options: ConvertOptions = {}
): GptSessionImportRecord {
  const accessToken = readAccessToken(record);
  if (!accessToken) {
    throw new Error('缺少 accessToken');
  }

  const now = options.now ?? new Date();
  const user = getRecord(record, 'user');
  const account = getRecord(record, 'account');
  const meta = getRecord(record, 'meta');
  const tokens = getRecord(record, 'tokens');
  const providerData = getRecord(record, 'providerSpecificData');
  const credentials = getRecord(record, 'credentials');
  const payload = parseJwtPayload(accessToken);
  const inputIdToken = readIdToken(record);
  const idPayload = parseJwtPayload(inputIdToken);
  const auth = getOpenAIAuthSection(payload);
  const idAuth = getOpenAIAuthSection(idPayload);
  const profile = getOpenAIProfileSection(payload);
  const refreshToken = readRefreshToken(record);
  const hasRefreshToken = Boolean(refreshToken);
  const expiresAt = hasRefreshToken
    ? undefined
    : firstNonEmpty(
        timestampFromUnixSeconds(payload?.exp),
        normalizeTimestamp(record.expires),
        normalizeTimestamp(record.expiresAt),
        normalizeTimestamp(record.expired),
        normalizeTimestamp(record.expires_at)
      );
  const email = firstNonEmpty(
    user?.email,
    record.email,
    meta?.label,
    record.label,
    credentials?.email,
    providerData?.email,
    profile.email,
    idPayload?.email,
    payload?.email
  );
  const accountId = firstNonEmpty(
    account?.id,
    record.account_id,
    tokens?.accountId,
    tokens?.account_id,
    record.chatgptAccountId,
    record.chatgpt_account_id,
    meta?.chatgptAccountId,
    meta?.chatgpt_account_id,
    tokens?.chatgptAccountId,
    tokens?.chatgpt_account_id,
    providerData?.chatgptAccountId,
    providerData?.chatgpt_account_id,
    credentials?.chatgpt_account_id,
    auth.chatgpt_account_id,
    idAuth.chatgpt_account_id,
    record.provider === 'codex' ? record.id : undefined
  );
  const userId = firstNonEmpty(
    user?.id,
    record.user_id,
    record.chatgptUserId,
    providerData?.chatgptUserId,
    providerData?.chatgpt_user_id,
    auth.chatgpt_user_id,
    auth.user_id,
    idAuth.chatgpt_user_id,
    idAuth.user_id
  );
  const planType = firstNonEmpty(
    account?.planType,
    account?.plan_type,
    record.planType,
    record.plan_type,
    providerData?.chatgptPlanType,
    providerData?.chatgpt_plan_type,
    credentials?.plan_type,
    auth.chatgpt_plan_type,
    idAuth.chatgpt_plan_type
  );
  const syntheticIdToken = inputIdToken
    ? undefined
    : buildSyntheticCodexIdToken(email, accountId, planType, userId, expiresAt, now);
  const idToken = firstNonEmpty(inputIdToken, syntheticIdToken);
  const name = firstNonEmpty(email, options.sourceName, 'ChatGPT Account') ?? 'ChatGPT Account';
  const cpa = compactAuth({
    type: 'codex',
    account_id: accountId,
    chatgpt_account_id: accountId,
    email,
    name,
    plan_type: planType,
    chatgpt_plan_type: planType,
    id_token: idToken,
    id_token_synthetic: syntheticIdToken ? true : undefined,
    access_token: accessToken,
    refresh_token: refreshToken || '',
    session_token: readSessionToken(record),
    last_refresh: normalizeTimestamp(now),
    expired: expiresAt,
    disabled: record.disabled === true ? true : undefined,
  });

  return {
    sourceName: firstNonEmpty(options.sourceName, DEFAULT_SOURCE_NAME) ?? DEFAULT_SOURCE_NAME,
    sourcePath: firstNonEmpty(options.sourcePath, '$') ?? '$',
    email,
    name,
    accountId,
    planType,
    expiresAt,
    hasRefreshToken,
    syntheticIdToken: Boolean(syntheticIdToken),
    cpa,
    fileName: buildCpaFileName(name, email, planType),
  };
}

export function parseGptSessionTextToCpa(
  text: string,
  options: { now?: Date } = {}
): GptSessionImportResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      records: [],
      issues: [],
      missingRefreshTokenCount: 0,
      syntheticIdTokenCount: 0,
    };
  }

  try {
    return convertParsedGptSessionValue(JSON.parse(trimmed) as unknown, options.now ?? new Date());
  } catch (error) {
    const lines = splitJsonLines(text);
    if (lines.length > 1) {
      return parseGptSessionJsonLines(lines, options.now ?? new Date());
    }

    return {
      records: [],
      issues: [
        {
          sourceName: DEFAULT_SOURCE_NAME,
          path: '$',
          reason: error instanceof Error ? `JSON 解析失败：${error.message}` : 'JSON 解析失败',
        },
      ],
      missingRefreshTokenCount: 0,
      syntheticIdTokenCount: 0,
    };
  }
}

export function consumeGptSessionInput(
  text: string,
  options: { now?: Date } = {}
): GptSessionConsumeResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return {
      records: [],
      issues: [],
      missingRefreshTokenCount: 0,
      syntheticIdTokenCount: 0,
      remainingText: '',
    };
  }

  const now = options.now ?? new Date();

  try {
    const result = convertParsedGptSessionValue(JSON.parse(trimmed) as unknown, now);
    return {
      ...result,
      remainingText: result.records.length > 0 ? '' : text,
    };
  } catch {
    return consumeGptSessionJsonLines(text, now);
  }
}

function convertParsedGptSessionValue(
  parsed: unknown,
  now: Date,
  sourceName = DEFAULT_SOURCE_NAME
): GptSessionImportResult {
  const sources = collectGptSessionSources(parsed, sourceName);
  const records: GptSessionImportRecord[] = [];
  const issues: GptSessionImportIssue[] = [];

  if (sources.length === 0) {
    issues.push({
      sourceName,
      path: '$',
      reason: '未找到包含 accessToken 和身份信息的 session 对象',
    });
  }

  sources.forEach((source) => {
    try {
      records.push(
        convertGptSessionToCpa(source.value, {
          now,
          sourceName: source.sourceName,
          sourcePath: source.path,
        })
      );
    } catch (error) {
      issues.push({
        sourceName: source.sourceName,
        path: source.path,
        reason: error instanceof Error ? error.message : '无法转换',
      });
    }
  });

  return {
    records,
    issues,
    missingRefreshTokenCount: records.filter((record) => !record.hasRefreshToken).length,
    syntheticIdTokenCount: records.filter((record) => record.syntheticIdToken).length,
  };
}

function splitJsonLines(text: string): Array<{ lineNumber: number; text: string }> {
  return text
    .split(/\r?\n/u)
    .map((line, index) => ({ lineNumber: index + 1, text: line.trim() }))
    .filter((line) => line.text !== '')
    .filter((line) => line.text.startsWith('{'));
}

function parseGptSessionJsonLines(
  lines: Array<{ lineNumber: number; text: string }>,
  now: Date
): GptSessionImportResult {
  const records: GptSessionImportRecord[] = [];
  const issues: GptSessionImportIssue[] = [];

  lines.forEach((line) => {
    const sourceName = `line ${line.lineNumber}`;
    try {
      const parsed = JSON.parse(line.text) as unknown;
      const result = convertParsedGptSessionValue(parsed, now, sourceName);
      records.push(...result.records);
      appendLineIssues(issues, result, sourceName);
    } catch (error) {
      issues.push({
        sourceName,
        path: sourceName,
        reason: error instanceof Error ? `JSON 解析失败：${error.message}` : 'JSON 解析失败',
      });
    }
  });

  return {
    records,
    issues,
    missingRefreshTokenCount: records.filter((record) => !record.hasRefreshToken).length,
    syntheticIdTokenCount: records.filter((record) => record.syntheticIdToken).length,
  };
}

function consumeGptSessionJsonLines(text: string, now: Date): GptSessionConsumeResult {
  const records: GptSessionImportRecord[] = [];
  const issues: GptSessionImportIssue[] = [];
  const remainingLines: string[] = [];

  text.split(/\r?\n/u).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) {
      return;
    }

    if (!trimmed.startsWith('{')) {
      return;
    }

    const sourceName = `line ${index + 1}`;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const result = convertParsedGptSessionValue(parsed, now, sourceName);
      records.push(...result.records);
      appendLineIssues(issues, result, sourceName);
      if (result.records.length === 0) {
        remainingLines.push(trimmed);
      }
    } catch (error) {
      issues.push({
        sourceName,
        path: sourceName,
        reason: error instanceof Error ? `JSON 解析失败：${error.message}` : 'JSON 解析失败',
      });
    }
  });

  return {
    records,
    issues,
    missingRefreshTokenCount: records.filter((record) => !record.hasRefreshToken).length,
    syntheticIdTokenCount: records.filter((record) => record.syntheticIdToken).length,
    remainingText: remainingLines.join('\n'),
  };
}

function appendLineIssues(
  issues: GptSessionImportIssue[],
  result: GptSessionImportResult,
  sourceName: string
) {
  result.issues.forEach((issue) => {
    issues.push({
      ...issue,
      sourceName,
      path: `${sourceName}:${issue.path}`,
    });
  });
}

export function buildGptSessionCpaFileSpecs(
  records: GptSessionImportRecord[]
): GptSessionCpaFileSpec[] {
  return records.map((record) => ({
    fileName: record.fileName,
    content: `${JSON.stringify(record.cpa, null, 2)}\n`,
  }));
}
