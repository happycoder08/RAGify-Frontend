/**
 * API client utilities for RAGify backend.
 */

import { getToken } from './auth';
import type {
  LoginRequest,
  LoginResponse,
  QueryRequest,
  DocumentsListResponse,
  UploadResponse,
  SSETokenEvent,
  SSEDebugEvent,
  SSEFinalEvent,
  SSEErrorEvent,
} from '../types/api';

// Get API base URL based on environment
// In dev mode: use relative URLs (Vite proxy handles routing)
// In production: use VITE_API_URL (required)
const API_URL = import.meta.env.DEV
  ? ''
  : (() => {
      const url = import.meta.env.VITE_API_URL;
      if (!url) {
        throw new Error(
          'VITE_API_URL environment variable is required in production'
        );
      }
      return url;
    })();

/**
 * Generic fetch wrapper with auth header.
 */
async function apiFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: HeadersInit = {
    ...options.headers,
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * Login with username and password.
 */
export async function login(credentials: LoginRequest): Promise<LoginResponse> {
  return apiFetch<LoginResponse>('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials),
  });
}

/**
 * List documents for current tenant.
 */
export async function listDocuments(): Promise<DocumentsListResponse> {
  return apiFetch<DocumentsListResponse>('/api/documents', {
    method: 'GET',
  });
}

/**
 * Upload documents.
 */
export async function uploadDocuments(files: File[]): Promise<UploadResponse> {
  const formData = new FormData();
  files.forEach((file) => {
    formData.append('files', file);
  });

  const token = getToken();
  const response = await fetch(`${API_URL}/api/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ detail: response.statusText }));
    throw new Error(error.detail || `HTTP ${response.status}`);
  }

  return response.json();
}

/**
 * SSE Event types from backend.
 */
export type SSEEvent =
  | { type: 'token'; data: SSETokenEvent }
  | { type: 'debug'; data: SSEDebugEvent }
  | { type: 'final'; data: SSEFinalEvent }
  | { type: 'error'; data: SSEErrorEvent };

/**
 * Query documents with SSE streaming.
 * 
 * CRITICAL: Event-based SSE parsing with clear stop conditions.
 * - Stops on 'final' event (complete response)
 * - Stops on 'error' event
 * - Timeout after 30 seconds
 * 
 * DO NOT use regex parsing - parse event: and data: lines explicitly.
 */
export async function queryWithSSE(
  request: QueryRequest,
  onEvent: (event: SSEEvent) => void,
  onError?: (error: Error) => void
): Promise<void> {
  const token = getToken();
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
    onError?.(new Error('Query timeout after 30 seconds'));
  }, 30000); // 30 second timeout

  try {
    const response = await fetch(`${API_URL}/api/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let currentEvent = '';

    // Event-based SSE parsing
    while (true) {
      const { done, value } = await reader.read();
      
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || ''; // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEvent = line.substring(7).trim();
        } else if (line.startsWith('data: ')) {
          const dataStr = line.substring(6);
          try {
            const data = JSON.parse(dataStr);
            
            // Emit event based on type
            if (currentEvent === 'token') {
              onEvent({ type: 'token', data: data as SSETokenEvent });
            } else if (currentEvent === 'debug') {
              onEvent({ type: 'debug', data: data as SSEDebugEvent });
            } else if (currentEvent === 'final') {
              onEvent({ type: 'final', data: data as SSEFinalEvent });
              clearTimeout(timeoutId);
              return; // Stop on final event
            } else if (currentEvent === 'error') {
              onEvent({ type: 'error', data: data as SSEErrorEvent });
              clearTimeout(timeoutId);
              throw new Error(data.detail || 'Query error');
            }
            
            currentEvent = ''; // Reset for next event
          } catch (parseError) {
            console.error('Failed to parse SSE data:', dataStr, parseError);
          }
        }
      }
    }
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      onError?.(new Error('Request cancelled'));
    } else {
      onError?.(error as Error);
    }
  } finally {
    clearTimeout(timeoutId);
  }
}
