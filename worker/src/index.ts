import { CollaborationRoom } from './room';
import { verifyAccessPrincipal } from './auth';
import { encodeInternalPrincipal, INTERNAL_PRINCIPAL_HEADER } from './internal-principal';

export { CollaborationRoom };

const ROOM_PATH = /^\/v1\/rooms\/(oc_[0-9a-f]{32})\/websocket$/;

const jsonError = (status: number, error: string): Response =>
  Response.json({ error }, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    },
  });

const allowedOrigins = (raw: string): Set<string> => {
  const values = new Set<string>();
  for (const entry of raw.split(',')) {
    const candidate = entry.trim();
    if (!candidate) continue;
    try {
      values.add(new URL(candidate).origin);
    } catch {
      // Invalid configured values never broaden access.
    }
  }
  return values;
};

const originIsAllowed = (request: Request, env: Env): boolean => {
  const origin = request.headers.get('Origin');
  if (!origin || !env.ALLOWED_ORIGINS) return false;
  try {
    return allowedOrigins(env.ALLOWED_ORIGINS).has(new URL(origin).origin);
  } catch {
    return false;
  }
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/healthz') {
      return Response.json({ ok: true, service: 'opencad-collaboration', protocol: 1 }, {
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    const match = ROOM_PATH.exec(url.pathname);
    if (!match) return jsonError(404, 'Not found');
    if (request.method !== 'GET' || request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return jsonError(426, 'WebSocket upgrade required');
    }
    if (!originIsAllowed(request, env)) return jsonError(403, 'Origin is not allowed');

    let principal;
    try {
      principal = await verifyAccessPrincipal(request, env);
    } catch {
      console.warn(JSON.stringify({ event: 'collaboration-auth-rejected', requestId: crypto.randomUUID() }));
      return jsonError(401, 'Cloudflare Access authentication required');
    }

    const roomId = match[1];
    const headers = new Headers({
      Upgrade: 'websocket',
      'X-OpenCAD-Room': roomId,
      [INTERNAL_PRINCIPAL_HEADER]: encodeInternalPrincipal(principal),
    });
    const stub = env.COLLAB_ROOM.getByName(roomId);
    try {
      return await stub.fetch(new Request('https://opencad.internal/websocket', { headers }));
    } catch {
      console.error(JSON.stringify({ event: 'collaboration-room-unavailable', requestId: crypto.randomUUID() }));
      return jsonError(503, 'Collaboration room is temporarily unavailable');
    }
  },
} satisfies ExportedHandler<Env>;
