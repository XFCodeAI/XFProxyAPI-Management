import { apiClient } from './client';

export type TwoFactorRecord = {
  id: string;
  accountName: string;
  secret: string;
  remark?: string;
  time: number;
  period?: number;
  digits?: number;
  algorithm?: string;
  token: string;
  timeRemaining: number;
  valid: boolean;
};

export type ParsedTwoFactorCredential = {
  accountName: string;
  secret: string;
  period?: number;
  digits?: number;
  algorithm?: string;
};

export type TwoFactorVaultResponse = {
  saved: TwoFactorRecord[];
  history: TwoFactorRecord[];
};

type TwoFactorQueryResponse = {
  credential: ParsedTwoFactorCredential;
  record: TwoFactorRecord;
};

type TwoFactorRecordResponse = {
  record: TwoFactorRecord;
};

type TwoFactorImportResponse = {
  status: string;
  imported: number;
  saved: TwoFactorRecord[];
};

export type TwoFactorImportRecord = {
  accountName?: string;
  secret: string;
  time?: number;
  remark?: string;
  period?: number;
  digits?: number;
  algorithm?: string;
};

export const twoFactorApi = {
  list: () => apiClient.get<TwoFactorVaultResponse>('/2fa'),

  query: (input: string) => apiClient.post<TwoFactorQueryResponse>('/2fa/query', { input }),

  token: (input: string) => apiClient.post<TwoFactorQueryResponse>('/2fa/token', { input }),

  saveRecord: (input: string, accountName?: string) =>
    apiClient.post<TwoFactorRecordResponse>('/2fa/records', { input, accountName }),

  updateRecord: (id: string, accountName: string) =>
    apiClient.patch<TwoFactorRecordResponse>(`/2fa/records/${encodeURIComponent(id)}`, {
      accountName,
    }),

  deleteRecord: (id: string) => apiClient.delete(`/2fa/records/${encodeURIComponent(id)}`),

  deleteHistoryRecord: (id: string) => apiClient.delete(`/2fa/history/${encodeURIComponent(id)}`),

  clearHistory: () => apiClient.delete('/2fa/history'),

  importRecords: (records: TwoFactorImportRecord[]) =>
    apiClient.post<TwoFactorImportResponse>('/2fa/import', records),
};
