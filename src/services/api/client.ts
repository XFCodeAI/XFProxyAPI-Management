/**
 * Axios API client replacing the original src/core/api-client.js module.
 */

import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from 'axios';
import type { ApiClientConfig, ApiError } from '@/types';
import {
  BUILD_DATE_HEADER_KEYS,
  CPA_BUILD_DATE_HEADER_KEYS,
  CPA_SUPPORT_PLUGIN_HEADER_KEYS,
  CPA_VERSION_HEADER_KEYS,
  HOME_BUILD_DATE_HEADER_KEYS,
  HOME_VERSION_HEADER_KEYS,
  REQUEST_TIMEOUT_MS,
  VERSION_HEADER_KEYS,
} from '@/utils/constants';
import { computeApiUrl } from '@/utils/connection';
import { isRecord } from '@/utils/helpers';
import type { ServerRuntimeKind } from '@/types';
import { parseApiErrorResponse } from './apiError';

class ApiClient {
  private instance: AxiosInstance;
  private apiBase: string = '';
  private managementKey: string = '';

  constructor() {
    this.instance = axios.create({
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.setupInterceptors();
  }

  /**
   * Set the API connection configuration.
   */
  setConfig(config: ApiClientConfig): void {
    this.apiBase = computeApiUrl(config.apiBase);
    this.managementKey = config.managementKey;

    if (config.timeout) {
      this.instance.defaults.timeout = config.timeout;
    } else {
      this.instance.defaults.timeout = REQUEST_TIMEOUT_MS;
    }
  }

  private readHeader(headers: Record<string, unknown> | undefined, keys: string[]): string | null {
    if (!headers) return null;

    const normalizeValue = (value: unknown): string | null => {
      if (value === undefined || value === null) return null;
      if (Array.isArray(value)) {
        const first = value.find(
          (entry) => entry !== undefined && entry !== null && String(entry).trim()
        );
        return first !== undefined ? String(first) : null;
      }
      const text = String(value);
      return text ? text : null;
    };

    const headerGetter = (headers as { get?: (name: string) => unknown }).get;
    if (typeof headerGetter === 'function') {
      for (const key of keys) {
        const match = normalizeValue(headerGetter.call(headers, key));
        if (match) return match;
      }
    }

    const entries =
      typeof (headers as { entries?: () => Iterable<[string, unknown]> }).entries === 'function'
        ? Array.from((headers as { entries: () => Iterable<[string, unknown]> }).entries())
        : Object.entries(headers);

    const normalized = Object.fromEntries(
      entries.map(([key, value]) => [String(key).toLowerCase(), value])
    );
    for (const key of keys) {
      const match = normalizeValue(normalized[key.toLowerCase()]);
      if (match) return match;
    }
    return null;
  }

  private readBooleanHeader(
    headers: Record<string, unknown> | undefined,
    keys: string[]
  ): boolean | null {
    const value = this.readHeader(headers, keys);
    if (value === null) return null;

    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return null;
  }

  /**
   * Configure request and response interceptors.
   */
  private setupInterceptors(): void {
    // Request interceptor
    this.instance.interceptors.request.use(
      (config) => {
        // Set baseURL
        config.baseURL = this.apiBase;
        if (config.url) {
          // Normalize deprecated Gemini endpoint to the current path.
          config.url = config.url.replace(/\/generative-language-api-key\b/g, '/gemini-api-key');
        }

        // Add the authentication header
        if (this.managementKey) {
          config.headers.Authorization = `Bearer ${this.managementKey}`;
        }

        return config;
      },
      (error) => Promise.reject(this.handleError(error))
    );

    // 响应拦截器
    this.instance.interceptors.response.use(
      (response) => {
        const headers = response.headers as Record<string, string | undefined>;
        const homeVersion = this.readHeader(headers, HOME_VERSION_HEADER_KEYS);
        const homeBuildDate = this.readHeader(headers, HOME_BUILD_DATE_HEADER_KEYS);
        const cpaVersion = this.readHeader(headers, CPA_VERSION_HEADER_KEYS);
        const cpaBuildDate = this.readHeader(headers, CPA_BUILD_DATE_HEADER_KEYS);
        const version = homeVersion || cpaVersion || this.readHeader(headers, VERSION_HEADER_KEYS);
        const buildDate =
          homeBuildDate || cpaBuildDate || this.readHeader(headers, BUILD_DATE_HEADER_KEYS);
        const supportsPlugin = this.readBooleanHeader(headers, CPA_SUPPORT_PLUGIN_HEADER_KEYS);
        const runtimeKind: ServerRuntimeKind | null =
          homeVersion || homeBuildDate ? 'home' : cpaVersion || cpaBuildDate ? 'cpa' : null;

        // Dispatch version updates for store synchronization
        if (version || buildDate || runtimeKind) {
          window.dispatchEvent(
            new CustomEvent('server-version-update', {
              detail: { version: version || null, buildDate: buildDate || null, runtimeKind },
            })
          );
        }
        if (supportsPlugin !== null) {
          window.dispatchEvent(
            new CustomEvent('server-plugin-support-update', {
              detail: { supportsPlugin },
            })
          );
        }

        return response;
      },
      (error) => Promise.reject(this.handleError(error))
    );
  }

  /**
   * Normalize request errors.
   */
  private handleError(error: unknown): ApiError {
    const axiosError = axios.isAxiosError(error) ? error : null;
    const errorRecord = isRecord(error) ? error : null;
    const responseData = axiosError?.response?.data;
    const fallbackResponseData =
      !axiosError && !(error instanceof Error) && isRecord(error) ? error : undefined;
    const parsedError = parseApiErrorResponse(axiosError ? responseData : fallbackResponseData, {
      status:
        axiosError?.response?.status ??
        (typeof errorRecord?.status === 'number' ? errorRecord.status : undefined),
      code:
        axiosError?.code ?? (typeof errorRecord?.code === 'string' ? errorRecord.code : undefined),
      message:
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : typeof errorRecord?.message === 'string'
              ? errorRecord.message
              : 'Unknown error occurred',
      details: errorRecord?.details ?? errorRecord?.data,
    });
    const apiError = new Error(parsedError.message) as ApiError;
    apiError.name = 'ApiError';
    apiError.status = parsedError.status;
    apiError.code = parsedError.code;
    apiError.details = parsedError.details;
    apiError.data = parsedError.details;

    // A 401 response invalidates the current management session
    if (axiosError?.response?.status === 401) {
      window.dispatchEvent(new Event('unauthorized'));
    }

    return apiError;
  }

  /**
   * Send a GET request.
   */
  async get<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.instance.get<T>(url, config);
    return response.data;
  }

  /**
   * Send a POST request.
   */
  async post<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.instance.post<T>(url, data, config);
    return response.data;
  }

  /**
   * Send a PUT request.
   */
  async put<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.instance.put<T>(url, data, config);
    return response.data;
  }

  /**
   * Send a PATCH request.
   */
  async patch<T = unknown>(url: string, data?: unknown, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.instance.patch<T>(url, data, config);
    return response.data;
  }

  /**
   * Send a DELETE request.
   */
  async delete<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<T> {
    const response = await this.instance.delete<T>(url, config);
    return response.data;
  }

  /**
   * Return the raw response for downloads and similar flows.
   */
  async getRaw(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse> {
    return this.instance.get(url, config);
  }

  /**
   * Send FormData.
   */
  async postForm<T = unknown>(
    url: string,
    formData: FormData,
    config?: AxiosRequestConfig
  ): Promise<T> {
    const response = await this.instance.post<T>(url, formData, {
      ...config,
      headers: {
        ...(config?.headers || {}),
        'Content-Type': 'multipart/form-data',
      },
    });
    return response.data;
  }

  /**
   * Expose axios.request for raw response flows.
   */
  async requestRaw(config: AxiosRequestConfig): Promise<AxiosResponse> {
    return this.instance.request(config);
  }
}

// Shared API client instance
export const apiClient = new ApiClient();
