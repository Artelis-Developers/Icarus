/**
 * Server-side origin allowlist for the portal postMessage handshake.
 * The client (@artelis/auth PortalAuthIntegration) POSTs a candidate origin here
 * and only trusts `ms-auth` messages from an allowed one. Origins are read from
 * ALLOWED_ORIGINS server-side — never hardcoded, never in the client bundle.
 * Mandatory — do not remove.
 */
import { createValidateOriginHandler } from '@artelis/auth/server';

export const { POST } = createValidateOriginHandler();
