// Collaboration entry point — re-exports the lazy-loadable modules
// so the rest of the app can `import('./collab')` once and pull the
// whole feature into a single chunk on demand.

export {
  connectCollab,
  disconnectCollab,
  isConnected,
  currentRoomCode,
  getYDoc,
  getYCollabMaps,
  getYAwareness,
  getProvider,
} from './yjs-doc';
export type { CollabHandle, ConnectOptions } from './yjs-doc';

export { bindStoreToYjs, bindYjsToStore, getCollabMaps } from './sync';
export type { CollabMaps } from './sync';

export {
  getLocalIdentity,
  setLocalName,
  setLocalPresence,
  clearLocalPresence,
  subscribeRemotePresence,
} from './presence';
export type { Identity, PresenceState } from './presence';

export {
  startSession,
  stopSession,
  isSessionActive,
  activeRoom,
  onRemotePresence,
  publishLocalPresence,
  peerCount,
} from './session';
export type { StartSessionOptions, SessionInfo } from './session';
