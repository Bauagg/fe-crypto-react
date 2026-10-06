import axios, { AxiosError } from 'axios';
import type { AxiosRequestConfig, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

import { crossPlatformStorage } from '@/utils/storage/crossPlatformStorage';

export interface FieldError {
  field: string;
  message: string;
}

interface BackendEnvelope<T> {
  status: 'success' | 'fail' | 'error';
  message: string;
  data?: T;
  errors?: FieldError[];
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  status: number;
  data: T | null;
  message: string;
  fieldErrors?: FieldError[];
  error?: unknown;
}

const API = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  timeout: 100000,
  headers: {},
});

const TOKEN_KEY = 'access_token';
const REFRESH_TOKEN_KEY = 'refresh_token';

const getAccessToken = async (): Promise<string | null> => {
  try {
    return await crossPlatformStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};

const getRefreshToken = async (): Promise<string | null> => {
  try {
    return await crossPlatformStorage.getItem(REFRESH_TOKEN_KEY);
  } catch {
    return null;
  }
};

const setTokens = async (accessToken: string, refreshToken: string): Promise<void> => {
  try {
    await crossPlatformStorage.setItem(TOKEN_KEY, accessToken);
    await crossPlatformStorage.setItem(REFRESH_TOKEN_KEY, refreshToken);
  } catch {
    // Silently fail to avoid UI disruption
  }
};

const setAccessToken = async (accessToken: string): Promise<void> => {
  try {
    await crossPlatformStorage.setItem(TOKEN_KEY, accessToken);
  } catch {
    // Silently fail to avoid UI disruption
  }
};

const clearTokens = async (): Promise<void> => {
  try {
    await crossPlatformStorage.deleteItem(TOKEN_KEY);
    await crossPlatformStorage.deleteItem(REFRESH_TOKEN_KEY);
  } catch {
    // Silently fail to avoid UI disruption
  }
};

const refreshAccessToken = async (): Promise<string | null> => {
  try {
    const refreshToken = await getRefreshToken();
    if (!refreshToken) return null;

    const response = await axios.post<BackendEnvelope<{ access_token: string }>>(
      `${import.meta.env.VITE_API_URL}/users/refresh-token`,
      { refresh_token: refreshToken }
    );

    const accessToken = response.data?.data?.access_token;
    if (accessToken) {
      await setAccessToken(accessToken);
      return accessToken;
    }
    return null;
  } catch {
    await clearTokens();
    return null;
  }
};

// Request interceptor: lampirkan access token ke semua request
API.interceptors.request.use(
  async (config: InternalAxiosRequestConfig): Promise<InternalAxiosRequestConfig> => {
    const token = await getAccessToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error: AxiosError) => Promise.reject(error)
);

// Response interceptor: refresh access token otomatis saat 401
API.interceptors.response.use(
  (response: AxiosResponse) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean };

    if (error.response?.status === 401 && originalRequest && !originalRequest._retry) {
      originalRequest._retry = true;

      const newToken = await refreshAccessToken();
      if (newToken) {
        originalRequest.headers.Authorization = `Bearer ${newToken}`;
        return API(originalRequest);
      }
    }

    return Promise.reject(error);
  }
);

const handleResponse = <T>(res: AxiosResponse<BackendEnvelope<T>>): ApiResponse<T> => {
  return {
    success: true,
    status: res.status,
    data: res.data?.data ?? null,
    message: res.data?.message ?? 'Success',
  };
};

const handleError = <T>(err: AxiosError<BackendEnvelope<unknown>>): ApiResponse<T> => {
  const status = err.response?.status || 500;
  const body = err.response?.data;

  return {
    success: false,
    status,
    data: null,
    message: body?.message || err.message || 'Something went wrong',
    fieldErrors: body?.errors,
    error: body || err,
  };
};

const api = {
  get: async <T = unknown>(
    url: string,
    params: Record<string, unknown> = {}
  ): Promise<ApiResponse<T>> => {
    try {
      const res = await API.get<BackendEnvelope<T>>(url, { params });
      return handleResponse<T>(res);
    } catch (err) {
      return handleError<T>(err as AxiosError<BackendEnvelope<unknown>>);
    }
  },

  post: async <T = unknown>(
    url: string,
    data: unknown = {},
    config: AxiosRequestConfig = {}
  ): Promise<ApiResponse<T>> => {
    try {
      const res = await API.post<BackendEnvelope<T>>(url, data, config);
      return handleResponse<T>(res);
    } catch (err) {
      return handleError<T>(err as AxiosError<BackendEnvelope<unknown>>);
    }
  },

  put: async <T = unknown>(
    url: string,
    data: unknown = {},
    config: AxiosRequestConfig = {}
  ): Promise<ApiResponse<T>> => {
    try {
      const res = await API.put<BackendEnvelope<T>>(url, data, config);
      return handleResponse<T>(res);
    } catch (err) {
      return handleError<T>(err as AxiosError<BackendEnvelope<unknown>>);
    }
  },

  patch: async <T = unknown>(
    url: string,
    data: unknown = {},
    config: AxiosRequestConfig = {}
  ): Promise<ApiResponse<T>> => {
    try {
      const res = await API.patch<BackendEnvelope<T>>(url, data, config);
      return handleResponse<T>(res);
    } catch (err) {
      return handleError<T>(err as AxiosError<BackendEnvelope<unknown>>);
    }
  },

  delete: async <T = unknown>(url: string): Promise<ApiResponse<T>> => {
    try {
      const res = await API.delete<BackendEnvelope<T>>(url);
      return handleResponse<T>(res);
    } catch (err) {
      return handleError<T>(err as AxiosError<BackendEnvelope<unknown>>);
    }
  },

  auth: {
    setTokens,
    setAccessToken,
    clearTokens,
    getAccessToken,
    getRefreshToken,
  },
};

export default api;
