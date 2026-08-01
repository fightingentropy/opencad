import { base64ToBytes, bytesToBase64, type CollaborationPresence } from '../../src/collab/protocol';
import type { AuthenticatedPrincipal } from './auth';

export const INTERNAL_PRINCIPAL_HEADER = 'X-OpenCAD-Principal';

export interface ConnectionAttachment {
  version: 1;
  roomId: string;
  connectionId: string;
  presenceId: number;
  principal: AuthenticatedPrincipal;
  joinedAt: number;
  rateWindowStartedAt: number;
  rateMessageCount: number;
  presence?: CollaborationPresence;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isRole = (value: unknown): value is AuthenticatedPrincipal['role'] =>
  value === 'owner' || value === 'editor' || value === 'viewer';

const isPrincipal = (value: unknown): value is AuthenticatedPrincipal =>
  isRecord(value)
  && typeof value.userId === 'string'
  && typeof value.email === 'string'
  && typeof value.name === 'string'
  && typeof value.color === 'string'
  && isRole(value.role);

export const encodeInternalPrincipal = (principal: AuthenticatedPrincipal): string =>
  bytesToBase64(new TextEncoder().encode(JSON.stringify(principal)));

export const decodeInternalPrincipal = (header: string | null): AuthenticatedPrincipal => {
  if (!header) throw new Error('Missing internal principal');
  const raw = new TextDecoder().decode(base64ToBytes(header, 8 * 1024));
  const value: unknown = JSON.parse(raw);
  if (!isPrincipal(value)) throw new Error('Invalid internal principal');
  return value;
};

export const isConnectionAttachment = (value: unknown): value is ConnectionAttachment => {
  if (!isRecord(value) || value.version !== 1 || !isPrincipal(value.principal)) return false;
  return typeof value.roomId === 'string'
    && typeof value.connectionId === 'string'
    && Number.isInteger(value.presenceId)
    && typeof value.joinedAt === 'number'
    && typeof value.rateWindowStartedAt === 'number'
    && Number.isInteger(value.rateMessageCount);
};
