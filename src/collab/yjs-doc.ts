// Singleton Y.Doc + WebRTC provider + IndexedDB persistence for the
// collaboration session. Lazy-initialised: nothing in this file runs
// until the user opens the Collaboration modal and calls
// `connectCollab()`. Single-player therefore pays zero cost — the
// chunk isn't even fetched.

import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { IndexeddbPersistence } from 'y-indexeddb';
import type { Awareness } from 'y-protocols/awareness';
import { getCollabMaps, type CollabMaps } from './sync';
import { assertSecureCollaborationRoomCode } from './room-code';
import { AuthenticatedDurableProvider } from './durable-provider';
import { getLocalIdentity } from './presence';
import type {
  CollaborationIdentity,
  CollaborationTransport,
} from './protocol';

// One Y.Doc per room per browser tab. Reconnecting to the same room reuses
// its document; switching rooms destroys it so state cannot bleed between
// otherwise unrelated collaboration sessions.
let doc: Y.Doc | null = null;
let maps: CollabMaps | null = null;
let documentRoom: string | null = null;
type CollaborationProvider = WebrtcProvider | AuthenticatedDurableProvider;

let provider: CollaborationProvider | null = null;
let persistence: IndexeddbPersistence | null = null;
let currentRoom: string | null = null;
let currentConnectionKey: string | null = null;

// v2 wire/persistence namespace. The v1 schema stored the whole project
// as one JSON blob (getMap('project'), IndexedDB `opencad-collab-*`);
// v2 fans the project out per entity (see ./sync). Bumping the room and
// IndexedDB prefixes keeps v1 docs and v1 peers from colliding with the
// new layout — user-visible room codes stay unchanged.
const ROOM_PREFIX = 'opencad-v2/';
const IDB_PREFIX = 'opencad-collab-v2-';

// Free public WebRTC signalling servers. These only relay connection
// offers; the actual document sync is peer-to-peer. Replace with a
// self-hosted signaller for production.
const DEFAULT_SIGNALING = [
  'wss://signaling.yjs.dev',
  'wss://y-webrtc-signaling-eu.herokuapp.com',
  'wss://y-webrtc-signaling-us.herokuapp.com',
];

export type CollaborationConnection =
  | { kind: 'authenticated'; endpoint: string }
  | { kind: 'anonymous-beta'; signaling?: string[] };

export interface ConnectOptions {
  room: string;
  connection: CollaborationConnection;
}

export interface CollabHandle {
  doc: Y.Doc;
  maps: CollabMaps;
  awareness: Awareness;
  room: string;
  transport: CollaborationTransport;
  ready: Promise<CollaborationIdentity>;
  disconnect: () => void;
}

const ensureDoc = (documentKey: string): { doc: Y.Doc; maps: CollabMaps } => {
  if (doc && maps && documentRoom === documentKey) return { doc, maps };
  doc?.destroy();
  const d = new Y.Doc();
  doc = d;
  maps = getCollabMaps(d);
  documentRoom = documentKey;
  return { doc: d, maps };
};

const connectionKey = (opts: ConnectOptions): string =>
  opts.connection.kind === 'authenticated'
    ? `authenticated:${opts.connection.endpoint}:${opts.room}`
    : `anonymous-beta:${opts.room}`;

/**
 * Connect to a collaboration room. Idempotent: calling with the same
 * room is a no-op; calling with a different room tears down the old
 * provider and creates a new one.
 */
export function connectCollab(opts: ConnectOptions): CollabHandle {
  assertSecureCollaborationRoomCode(opts.room);
  const nextConnectionKey = connectionKey(opts);

  if (currentConnectionKey !== nextConnectionKey) {
    if (provider) {
      provider.destroy();
      provider = null;
    }
    if (persistence) {
      persistence.destroy();
      persistence = null;
    }
    const { doc: d } = ensureDoc(nextConnectionKey);
    if (opts.connection.kind === 'authenticated') {
      // The Durable Object is authoritative. Deliberately do not share an
      // IndexedDB document cache between different signed-in users on the
      // same browser profile.
      provider = new AuthenticatedDurableProvider(opts.connection.endpoint, opts.room, d);
    } else {
      persistence = new IndexeddbPersistence(`${IDB_PREFIX}${opts.room}`, d);
      provider = new WebrtcProvider(`${ROOM_PREFIX}${opts.room}`, d, {
        signaling: opts.connection.signaling ?? DEFAULT_SIGNALING,
      });
    }
    currentRoom = opts.room;
    currentConnectionKey = nextConnectionKey;
  }

  const { doc: d, maps: m } = ensureDoc(nextConnectionKey);

  if (!provider) throw new Error('Collaboration provider failed to initialise');
  const local = getLocalIdentity();

  return {
    doc: d,
    maps: m,
    awareness: provider.awareness,
    room: opts.room,
    transport: opts.connection.kind,
    ready: provider instanceof AuthenticatedDurableProvider
      ? provider.ready
      : Promise.resolve({ ...local, role: 'owner' }),
    disconnect: () => disconnectCollab(),
  };
}

/** Tear down the WebRTC provider but keep the local Y.Doc + IndexedDB cache. */
export function disconnectCollab(): void {
  if (provider) {
    provider.destroy();
    provider = null;
  }
  if (persistence) {
    persistence.destroy();
    persistence = null;
  }
  currentRoom = null;
  currentConnectionKey = null;
}

export function isConnected(): boolean {
  return provider !== null;
}

export function currentRoomCode(): string | null {
  return currentRoom;
}

export function getYDoc(): Y.Doc {
  if (!doc) throw new Error('Collaboration document unavailable — connect to a room first');
  return doc;
}

export function getYCollabMaps(): CollabMaps {
  if (!maps) throw new Error('Collaboration document unavailable — connect to a room first');
  return maps;
}

export function getYAwareness(): Awareness {
  if (!provider) {
    throw new Error('Collaboration not connected — call connectCollab() first');
  }
  return provider.awareness;
}

export function getProvider(): CollaborationProvider | null {
  return provider;
}
