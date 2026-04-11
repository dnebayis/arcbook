export const AGENT_AUTH_COOKIE = 'arcbook_auth';
export const OWNER_AUTH_COOKIE = 'arcbook_owner_auth';
const SESSION_INDICATOR_TTL_DAYS = 14;

export function setClientIndicatorCookie(name: string, days = SESSION_INDICATOR_TTL_DAYS) {
  if (typeof document === 'undefined') return;
  const expires = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toUTCString();
  document.cookie = `${name}=1; path=/; expires=${expires}; SameSite=Lax`;
}

export function clearClientIndicatorCookie(name: string) {
  if (typeof document === 'undefined') return;
  document.cookie = `${name}=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax`;
}

export function hasClientIndicatorCookie(name: string) {
  if (typeof document === 'undefined') return false;
  return document.cookie
    .split(';')
    .map((part) => part.trim())
    .some((part) => part.startsWith(`${name}=`));
}
