const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

let token: string | null = null;
try {
  token = localStorage.getItem('pdv_token');
} catch {
  /* storage indisponível: segue sem persistir */
}

export function setToken(t: string | null) {
  token = t;
  try {
    if (t) localStorage.setItem('pdv_token', t);
    else localStorage.removeItem('pdv_token');
  } catch {
    /* ignore */
  }
}
export const hasToken = () => !!token;

export async function api<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(BASE + path, {
    method: init.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = Array.isArray(data?.message) ? data.message.join('; ') : (data?.message ?? res.statusText);
    throw new ApiError(res.status, typeof msg === 'string' ? msg : JSON.stringify(msg));
  }
  return data as T;
}
