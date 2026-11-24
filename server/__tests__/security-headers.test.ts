// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import config, { securityHeaders } from '../../vite.config';

// The Tailwind plugin cannot load inside Vitest, and the test only needs the config object
vi.mock('@tailwindcss/vite', () => ({ default: () => ({ name: 'tailwindcss' }) }));

describe('securityHeaders', () => {
  it('sets the companion headers', () => {
    expect(securityHeaders['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(securityHeaders['X-Content-Type-Options']).toBe('nosniff');
    expect(securityHeaders['X-Frame-Options']).toBe('DENY');
  });

  it('has a CSP that blocks framing, plugins and <base> but leaves scripts and styles alone', () => {
    const csp = securityHeaders['Content-Security-Policy'];
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("img-src 'self' data: blob: https://models.dev");
    expect(csp).not.toMatch(/script-src|style-src|default-src/);
  });

  it('is sent by the dev server and the preview server', () => {
    const resolved = config as { server?: { headers?: unknown }; preview?: { headers?: unknown } };
    expect(resolved.server?.headers).toBe(securityHeaders);
    expect(resolved.preview?.headers).toBe(securityHeaders);
  });
});
