// Awareness-based presence: cursor position, current sheet, selection,
// and identity (name + colour). Each peer publishes their own state
// via Yjs awareness; remote state is observed and surfaced via the
// `subscribeRemotePresence` callback for the `<PresenceLayer />` to
// render.

import type { Awareness } from 'y-protocols/awareness';
import type { EntityId, Vec2 } from '../types';

// Stable session ID per browser tab — survives reloads via
// sessionStorage, but a new tab gets a new identity. Matches the
// "Figma cursor" UX where each tab is a distinct presence.
const SESSION_KEY = 'opencad.collab.userId';
const NAME_KEY = 'opencad.collab.userName';
const COLOR_KEY = 'opencad.collab.userColor';

const PALETTE = [
  '#ff6b6b', '#ffa94d', '#ffd43b', '#a3e635',
  '#51cf66', '#22d3ee', '#3ba3ff', '#8b6cff',
  '#c084fc', '#f472b6', '#fb7185', '#94a3b8',
];

const randomFromPalette = (): string =>
  PALETTE[Math.floor(Math.random() * PALETTE.length)];

const randomName = (): string => {
  const adjectives = ['Quick', 'Bright', 'Calm', 'Bold', 'Keen', 'Sharp', 'Cool', 'Warm'];
  const animals = ['Heron', 'Otter', 'Fox', 'Lynx', 'Owl', 'Wren', 'Hare', 'Stoat'];
  return `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${animals[Math.floor(Math.random() * animals.length)]}`;
};

const stableUserId = (): string => {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id = 'u_' + Math.random().toString(36).slice(2, 11);
    sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return 'u_' + Math.random().toString(36).slice(2, 11);
  }
};

export interface Identity {
  userId: string;
  name: string;
  color: string;
}

/**
 * Resolve the local user's identity. Persists across reloads in
 * sessionStorage so a refresh keeps the same name/colour.
 */
export function getLocalIdentity(): Identity {
  const userId = stableUserId();
  let name = '';
  let color = '';
  try {
    name = sessionStorage.getItem(NAME_KEY) ?? '';
    color = sessionStorage.getItem(COLOR_KEY) ?? '';
  } catch {
    // ignore — fall through to defaults
  }
  if (!name) {
    name = randomName();
    try { sessionStorage.setItem(NAME_KEY, name); } catch { /* ignore */ }
  }
  if (!color) {
    color = randomFromPalette();
    try { sessionStorage.setItem(COLOR_KEY, color); } catch { /* ignore */ }
  }
  return { userId, name, color };
}

/** Override the user's name (persisted in sessionStorage). */
export function setLocalName(name: string): void {
  try { sessionStorage.setItem(NAME_KEY, name); } catch { /* ignore */ }
}

export interface PresenceState {
  userId: string;
  name: string;
  color: string;
  sheetId?: string;
  cursor?: Vec2;
  selection?: EntityId[];
  /** Last-update timestamp, used to fade stale cursors. */
  ts?: number;
}

/**
 * Publish the local user's presence to the awareness channel.
 * Lightweight — call as often as the cursor moves (debounced ~30ms
 * upstream by the canvas).
 */
export function setLocalPresence(
  awareness: Awareness,
  partial: Omit<Partial<PresenceState>, 'userId' | 'name' | 'color'>,
): void {
  const id = getLocalIdentity();
  const merged: PresenceState = {
    userId: id.userId,
    name: id.name,
    color: id.color,
    ts: Date.now(),
    ...partial,
  };
  awareness.setLocalState(merged);
}

/** Drop the local presence record (e.g. on disconnect). */
export function clearLocalPresence(awareness: Awareness): void {
  awareness.setLocalState(null);
}

/**
 * Subscribe to remote peers' presence. Fires immediately with the
 * current snapshot, and again on every change. Returns an unsubscribe
 * function.
 */
export function subscribeRemotePresence(
  awareness: Awareness,
  callback: (states: PresenceState[]) => void,
): () => void {
  const localId = awareness.clientID;
  const emit = () => {
    const states: PresenceState[] = [];
    awareness.getStates().forEach((value, clientId) => {
      if (clientId === localId) return; // skip self
      const v = value as Partial<PresenceState> | null;
      if (!v || !v.userId) return;
      states.push({
        userId: v.userId,
        name: v.name ?? 'Anonymous',
        color: v.color ?? '#888',
        sheetId: v.sheetId,
        cursor: v.cursor,
        selection: v.selection,
        ts: v.ts,
      });
    });
    callback(states);
  };
  awareness.on('change', emit);
  emit();
  return () => awareness.off('change', emit);
}
