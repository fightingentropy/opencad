import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import type { CollaborationIdentity, CollaborationRole } from '../../src/collab/protocol';

export interface AccessAuthEnvironment {
  ACCESS_TEAM_DOMAIN: string;
  ACCESS_AUD: string;
  ACCESS_OWNER_EMAILS?: string;
  ACCESS_EDITOR_EMAILS?: string;
  ACCESS_OWNER_GROUPS?: string;
  ACCESS_EDITOR_GROUPS?: string;
}

export interface AuthenticatedPrincipal extends CollaborationIdentity {
  email: string;
}

const PALETTE = [
  '#ff6b6b', '#ffa94d', '#ffd43b', '#a3e635', '#51cf66', '#22d3ee',
  '#3ba3ff', '#8b6cff', '#c084fc', '#f472b6', '#fb7185', '#94a3b8',
] as const;

// Configuration-scoped cache only: the issuer comes from Worker bindings,
// never from request input. jose handles key rotation/refresh internally.
const jwksByIssuer = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

const splitConfig = (value: string | undefined): Set<string> =>
  new Set((value ?? '').split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean));

const stringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string').map((entry) => entry.toLowerCase())
    : [];

const groupsFromClaims = (payload: JWTPayload): Set<string> => {
  const groups = new Set(stringArray(payload.groups));
  for (const containerName of ['custom', 'identity']) {
    const container = payload[containerName];
    if (typeof container !== 'object' || container === null || Array.isArray(container)) continue;
    for (const group of stringArray((container as Record<string, unknown>).groups)) groups.add(group);
  }
  return groups;
};

const intersects = (left: Set<string>, right: Set<string>): boolean => {
  for (const value of left) if (right.has(value)) return true;
  return false;
};

export const roleForAccessClaims = (
  payload: JWTPayload,
  env: AccessAuthEnvironment,
): CollaborationRole => {
  const email = typeof payload.email === 'string' ? payload.email.toLowerCase() : '';
  const groups = groupsFromClaims(payload);
  if (
    splitConfig(env.ACCESS_OWNER_EMAILS).has(email)
    || intersects(groups, splitConfig(env.ACCESS_OWNER_GROUPS))
  ) return 'owner';
  if (
    splitConfig(env.ACCESS_EDITOR_EMAILS).has(email)
    || intersects(groups, splitConfig(env.ACCESS_EDITOR_GROUPS))
  ) return 'editor';
  return 'viewer';
};

const normalizedTeamDomain = (raw: string): string => {
  const url = new URL(raw);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.cloudflareaccess.com')) {
    throw new Error('ACCESS_TEAM_DOMAIN must be an HTTPS Cloudflare Access team domain');
  }
  url.pathname = '';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/, '');
};

const displayName = (payload: JWTPayload, email: string): string => {
  const candidate = typeof payload.name === 'string' ? payload.name : email.split('@')[0];
  const clean = [...candidate]
    .filter((character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127)
    .join('')
    .trim()
    .slice(0, 80);
  return clean || 'Authenticated user';
};

const identityColor = async (subject: string): Promise<string> => {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(subject)));
  return PALETTE[digest[0] % PALETTE.length];
};

const jwksForIssuer = (issuer: string): ReturnType<typeof createRemoteJWKSet> => {
  const existing = jwksByIssuer.get(issuer);
  if (existing) return existing;
  const created = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
  jwksByIssuer.set(issuer, created);
  return created;
};

export const verifyAccessPrincipal = async (
  request: Request,
  env: AccessAuthEnvironment,
): Promise<AuthenticatedPrincipal> => {
  if (!env.ACCESS_AUD || !env.ACCESS_TEAM_DOMAIN) throw new Error('Cloudflare Access is not configured');
  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) throw new Error('Missing Cloudflare Access assertion');
  const issuer = normalizedTeamDomain(env.ACCESS_TEAM_DOMAIN);
  const { payload } = await jwtVerify(token, jwksForIssuer(issuer), {
    issuer,
    audience: env.ACCESS_AUD,
    algorithms: ['RS256'],
    clockTolerance: 5,
  });
  if (typeof payload.sub !== 'string' || payload.sub.length === 0 || payload.sub.length > 256) {
    throw new Error('Cloudflare Access token has no valid subject');
  }
  if (typeof payload.email !== 'string' || payload.email.length === 0 || payload.email.length > 320) {
    throw new Error('Cloudflare Access token has no valid email');
  }
  const email = payload.email.toLowerCase();
  return {
    userId: payload.sub,
    email,
    name: displayName(payload, email),
    color: await identityColor(payload.sub),
    role: roleForAccessClaims(payload, env),
  };
};
