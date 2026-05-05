// Singleton Y.Doc + WebRTC provider + IndexedDB persistence for the
// collaboration session. Lazy-initialised: nothing in this file runs
// until the user opens the Collaboration modal and calls
// `connectCollab()`. Single-player therefore pays zero cost — the
// chunk isn't even fetched.

import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { IndexeddbPersistence } from 'y-indexeddb';
import type { Awareness } from 'y-protocols/awareness';

// One Y.Doc per browser tab. We don't tear it down between sessions —
// reconnecting to the same room simply reuses the existing doc.
let doc: Y.Doc | null = null;
let projectMap: Y.Map<unknown> | null = null;
let provider: WebrtcProvider | null = null;
let persistence: IndexeddbPersistence | null = null;
let currentRoom: string | null = null;

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
  projectMap: Y.Map<unknown>;
  awareness: Awareness;
  room: string;
  /** Disconnect WebRTC; the local Y.Doc and IndexedDB cache stay. */
  disconnect: () => void;
}

const ensureDoc = (): { doc: Y.Doc; projectMap: Y.Map<unknown> } => {
  if (doc && projectMap) return { doc, projectMap };
  const d = new Y.Doc();
  doc = d;
  projectMap = d.getMap<unknown>('project');
  return { doc: d, projectMap };
};

/**
 * Connect to a collaboration room. Idempotent: calling with the same
 * room is a no-op; calling with a different room tears down the old
 * provider and creates a new one.
 */
export function connectCollab(opts: ConnectOptions): CollabHandle {
  const { doc: d, projectMap: pm } = ensureDoc();

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
    persistence = new IndexeddbPersistence(`opencad-collab-${opts.room}`, d);
    provider = new WebrtcProvider(opts.room, d, {
      signaling: opts.signaling ?? DEFAULT_SIGNALING,
    });
    currentRoom = opts.room;
  }

  if (!provider) throw new Error('WebRTC provider failed to initialise');

  return {
    doc: d,
    projectMap: pm,
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

export function getYProjectMap(): Y.Map<unknown> {
  return ensureDoc().projectMap;
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
