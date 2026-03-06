# Security Review Report — local-llm-ui

**Date**: 2026-03-06  
**Reviewer**: security-reviewer (automated)  
**Scope**: Full project audit (5 phases)

## Executive Summary

**14 findings**: 1 critical, 3 high, 5 medium, 2 low, 3 informational

The most urgent risks are around the MCP integration: user-controlled `command`/`args` spawn child processes without server-side validation, and the full `process.env` (including AWS credentials) is leaked to every stdio MCP server. CORS wildcard, missing rate limiting, and no request body size limits affect all proxies.

## Findings

### [CRITICAL] SEC-01: Arbitrary Command Execution via MCP stdio Config

**Category**: C1 — Command Injection via stdio MCP servers  
**File(s)**: `server/mcp-manager.ts` (lines 53–61)  
**Description**: MCP server configs are sent from the client in the request body. The `command` and `args` fields for stdio transports are passed directly to `Experimental_StdioMCPTransport` with no server-side validation.  
**Impact**: Any code that can modify the HTTP request body can execute arbitrary commands on the host machine.  
**Remediation**: Add server-side command allowlist + shell metacharacter validation on args.  
**Priority**: **Immediate**

### [HIGH] SEC-02: Full process.env Leaked to MCP stdio Child Processes

**Category**: LLM02 + C1  
**File(s)**: `server/mcp-manager.ts` (line 58)  
**Description**: `{ ...process.env, ...stdioConfig.env }` leaks all server-side secrets (AWS creds, etc.) to every MCP child process.  
**Remediation**: Use explicit allowlist of safe env vars (PATH, HOME, USER, LANG, NODE_ENV).  
**Priority**: **Immediate**

### [HIGH] SEC-03: SSRF via MCP HTTP/SSE Server URLs

**Category**: C2 — SSRF  
**File(s)**: `server/mcp-manager.ts` (lines 63–76)  
**Description**: No validation on MCP HTTP/SSE URLs — can target cloud metadata endpoints (169.254.169.254), localhost, or internal services.  
**Remediation**: Block private IPs, metadata endpoints, and localhost.  
**Priority**: **Short-term**

### [HIGH] SEC-04: API Keys Stored in Plaintext localStorage

**Category**: LLM02 / B4  
**File(s)**: `src/utils/preferences.ts`  
**Description**: 5 API keys + MCP auth headers stored in plaintext localStorage. Any XSS escalates to full key theft.  
**Remediation**: Document as known limitation; consider sessionStorage or encrypted storage long-term.  
**Priority**: **Short-term**

### [MEDIUM] SEC-05: CORS Wildcard on All Proxies

**Category**: B3  
**File(s)**: `server/bedrock-aisdk-proxy.ts`, `server/mantle-proxy.ts`, `server/bedrock-proxy.ts`, `server/lmstudio-proxy.ts`  
**Description**: `Access-Control-Allow-Origin: *` on all proxies.  
**Remediation**: Restrict to Vite dev server origin.  
**Priority**: **Short-term**

### [MEDIUM] SEC-06: No Rate Limiting on Any Endpoint

**Category**: B6 / LLM10  
**Description**: Zero rate limiting across all proxy endpoints.  
**Priority**: **Short-term**

### [MEDIUM] SEC-07: No Request Body Size Limits

**Category**: B1 / B6  
**Description**: All proxies read request body with no size limit via `body += chunk` pattern.  
**Remediation**: Add 10MB limit with 413 response.  
**Priority**: **Short-term**

### [MEDIUM] SEC-08: Error Messages Expose Internal Details

**Category**: B5  
**File(s)**: `server/bedrock-aisdk-proxy.ts`, `server/mantle-proxy.ts`  
**Description**: Raw `err.message` sent to client — may contain AWS account IDs, ARNs, internal paths.  
**Priority**: **Long-term**

### [MEDIUM] SEC-09: No Upper Bound on maxTokens

**Category**: LLM10  
**Description**: `max_tokens` passed through without cap — user can set 1,000,000.  
**Remediation**: `Math.min(request.max_tokens ?? 2048, 16384)`.  
**Priority**: **Short-term**

### [LOW] SEC-10: No Connection Timeout for MCP Clients

**Category**: C4  
**File(s)**: `server/mcp-manager.ts`  
**Description**: `createMCPClient()` called with no timeout — hangs indefinitely on unresponsive servers.  
**Remediation**: `Promise.race` with 10s timeout.  
**Priority**: **Short-term**

### [LOW] SEC-11: No Server-Side Runtime Validation of MCP Config Structure

**Category**: B1 / C1  
**Description**: TypeScript types don't enforce at runtime. No zod/joi validation on MCP configs from request body.  
**Priority**: **Short-term**

### [INFO] SEC-12: Security Headers Not Set

**Category**: B3  
**Description**: No CSP, X-Content-Type-Options, etc. Expected for Vite dev server.  
**Priority**: **Long-term**

### [INFO] SEC-13: Streamdown Markdown Rendering Uses rehype-sanitize (POSITIVE)

**Description**: LLM output rendered through rehype-sanitize — robust XSS mitigation.

### [INFO] SEC-14: MCP Tool Results Flow Back Into LLM Context (Indirect Prompt Injection)

**Category**: LLM01  
**Description**: Architecture-level concern — MCP tool results re-enter LLM context. Inherent to tool-use pattern.  
**Priority**: **Long-term**

## Positive Security Practices

1. API keys on headers, not URLs
2. AWS credentials via provider chain (server-side only)
3. `npm audit` — 0 vulnerabilities
4. `.env` properly gitignored + lock file committed
5. Abort signal support on all proxies
6. rehype-sanitize for LLM markdown output
7. MCP tool namespacing prevents collisions
8. `Promise.allSettled` for partial MCP failure tolerance
9. File upload filename sanitization

## Recommended Improvements (Prioritized)

| Priority | Action | Finding |
|----------|--------|---------|
| **Immediate** | MCP stdio command allowlist | SEC-01 |
| **Immediate** | Stop leaking process.env to MCP children | SEC-02 |
| **Short-term** | SSRF protection for MCP URLs | SEC-03 |
| **Short-term** | Restrict CORS to dev server origin | SEC-05 |
| **Short-term** | Request body size limits | SEC-07 |
| **Short-term** | MCP config runtime validation (zod) | SEC-11 |
| **Short-term** | MCP client connection timeout | SEC-10 |
| **Short-term** | Cap maxOutputTokens server-side | SEC-09 |
| **Short-term** | Basic rate limiting | SEC-06 |
| **Long-term** | Sanitize error responses | SEC-08 |
| **Long-term** | sessionStorage for API keys | SEC-04 |
| **Long-term** | CSP/security headers for production | SEC-12 |
