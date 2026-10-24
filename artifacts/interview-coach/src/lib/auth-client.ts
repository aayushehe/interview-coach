// Browser side of the account system: keeps the token, adds it to every API call,
// and signs the user out if the server says the token is no longer valid.
const TOKEN_KEY = 'interview-coach-token';
const USER_KEY = 'interview-coach-user';
export const UNAUTHORIZED_EVENT = 'interview-coach:unauthorized';

export type AuthUser = { id?: string; name: string; email: string };

const base = () => import.meta.env.VITE_API_BASE_URL || '';

export function getToken(): string | null {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
}

export function getStoredUser(): AuthUser | null {
  if (!getToken()) return null; // an old demo sign-in without a token no longer counts
  try {
    const raw = localStorage.getItem(USER_KEY);
    const user = raw ? (JSON.parse(raw) as AuthUser) : null;
    return user && typeof user.email === 'string' ? user : null;
  } catch { return null; }
}

export function saveSession(token: string, user: AuthUser) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } catch { /* storage blocked: the user will simply have to sign in again next time */ }
}

export function clearSession() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
    Object.keys(sessionStorage).filter((k) => k.startsWith('interview-')).forEach((k) => sessionStorage.removeItem(k));
  } catch { /* ignore */ }
}

/** fetch() that sends the token. A 401 while signed in logs the user out everywhere. */
export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken();
  const headers = new Headers(init.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  const res = await fetch(input, { ...init, headers });
  if (res.status === 401 && token) {
    clearSession();
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }
  return res;
}

export class AuthError extends Error {}

/** Sign in or create an account. Throws AuthError with a message that is safe to show. */
export async function authenticate(
  mode: 'login' | 'signup',
  input: { name?: string; email: string; password: string },
): Promise<AuthUser> {
  let res: Response;
  try {
    res = await fetch(`${base()}/api/auth/${mode === 'signup' ? 'register' : 'login'}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
  } catch {
    throw new AuthError('Could not reach the server. Make sure the app is running and try again.');
  }
  let data: { token?: string; user?: AuthUser; error?: string } = {};
  try { data = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok || !data.token || !data.user) throw new AuthError(data.error || 'Sign in failed. Please try again.');
  saveSession(data.token, data.user);
  return data.user;
}

/** Ask the server whether the saved token still works (authFetch signs out on 401). */
export async function checkSession(): Promise<void> {
  if (!getToken()) return;
  try { await authFetch(`${base()}/api/auth/me`); } catch { /* offline: keep the session */ }
}
