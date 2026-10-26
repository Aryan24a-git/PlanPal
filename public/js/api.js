/**
 * PlanPal API Client & Session Management
 * SEC-001: JWT authentication token storage and authenticated request wrapper.
 *
 * Token Storage Architecture:
 * - JWT stored in client-side localStorage under key 'planpal_token'.
 * - Transmitted on all protected requests via Authorization: Bearer <token>.
 * - XSS Mitigation: Comprehensive escapeHtml() encoding across all DOM renderers
 *   combined with strict Content-Security-Policy (CSP) headers prevents script injection.
 */

const TOKEN_KEY = 'planpal_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || null;
}

export function setToken(token) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export async function apiRequest(path, options = {}) {
  const token = getToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const errorMsg = data?.error?.message || data?.message || data?.error || 'Request failed';
    throw new Error(errorMsg);
  }
  return data;
}
