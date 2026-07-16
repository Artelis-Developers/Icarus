/** `firstname.lastname@artelis.net` -> "Firstname Lastname". Falls back to the raw local part. */
export function nameFromEmailLocalPart(email: string): string {
  const localPart = email.split('@')[0] ?? '';
  const titleCased = localPart
    .split('.')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase());
  return titleCased.length > 0 ? titleCased.join(' ') : localPart;
}

/** Client-side only: read `email` from an id token payload without verification (UI display). */
export function emailFromUnverifiedIdToken(idToken: string): string | undefined {
  try {
    const payload = idToken.split('.')[1];
    if (!payload) return undefined;
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const claims = JSON.parse(atob(padded));
    return typeof claims.email === 'string' && claims.email ? claims.email : undefined;
  } catch {
    return undefined;
  }
}

/** Cognito SSO-federated users often carry an opaque `sso_...` username unsuitable for display. */
export function isOpaqueSsoUsername(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  return /^sso_/i.test(trimmed);
}
