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

// One Y.Doc per browser tab. We don't tear it down between sessions —
// reconnecting to the same room simply reuses the existing doc.
let doc: Y.Doc | null = null;
let maps: CollabMaps | null = null;
let provider: WebrtcProvider | null = null;
let persistence: IndexeddbPersistence | null = null;
let currentRoom: string | null = null;

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

export interface ConnectOptions {
  /** Room code — anyone with this code joins the session. */
  room: string;
  /** Optional WebRTC signalling endpoints. */
  signaling?: string[];
}

export interface CollabHandle {
  doc: Y.Doc;
  maps: CollabMaps;
  awareness: Awareness;
  room: string;
  /** Disconnect WebRTC; the local Y.Doc and IndexedDB cache stay. */
  disconnect: () => void;
}

const ensureDoc = (): { doc: Y.Doc; maps: CollabMaps } => {
  if (doc && maps) return { doc, maps };
  const d = new Y.Doc();
  doc = d;
  maps = getCollabMaps(d);
  return { doc: d, maps };
};

/**
 * Connect to a collaboration room. Idempotent: calling with the same
 * room is a no-op; calling with a different room tears down the old
 * provider and creates a new one.
 */
export function connectCollab(opts: ConnectOptions): CollabHandle {
  const { doc: d, maps: m } = ensureDoc();

  if (currentRoom !== opts.room) {
    if (provider) {
      provider.destroy();
      provider = null;
    }
    if (persistence) {
      persistence.destroy();
      persistence = null;
    }
    // IndexedDB persistence — survives reload, replaces localStorage
    // for the duration of a collab session.
    persistence = new IndexeddbPersistence(`${IDB_PREFIX}${opts.room}`, d);
    provider = new WebrtcProvider(`${ROOM_PREFIX}${opts.room}`, d, {
      signaling: opts.signaling ?? DEFAULT_SIGNALING,
    });
    currentRoom = opts.room;
  }

  if (!provider) throw new Error('WebRTC provider failed to initialise');

  return {
    doc: d,
    maps: m,
    awareness: provider.awareness,
    room: opts.room,
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
}

export function isConnected(): boolean {
  return provider !== null;
}

export function currentRoomCode(): string | null {
  return currentRoom;
}

export function getYDoc(): Y.Doc {
  return ensureDoc().doc;
}

export function getYCollabMaps(): CollabMaps {
  return ensureDoc().maps;
}

export function getYAwareness(): Awareness {
  if (!provider) {
    throw new Error('Collaboration not connected — call connectCollab() first');
  }
  return provider.awareness;
}

export function getProvider(): WebrtcProvider | null {
  return provider;
}
