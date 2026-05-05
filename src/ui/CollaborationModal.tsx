import React, { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import {
  loadCollab,
  isCollabLoaded,
  isActive as isCollabActive,
  _setActive as setCollabActive,
} from '../collab/runtime';

type Status = 'idle' | 'loading' | 'connected' | 'error';

// Tracks the most recent presence snapshot and peer count so the
// modal can render "Connected to N peers" without re-importing the
// session module every render.
interface ConnectedInfo {
  room: string;
  peers: { userId: string; name: string; color: string }[];
}

export function CollaborationModal({ onClose }: { onClose: () => void }) {
  const projectId = useStore((s) => s.project.id);
  const projectName = useStore((s) => s.project.name);

  const [room, setRoom] = useState<string>(() =>
    // Already-connected sessions keep their room; fresh modals seed
    // from the project ID so the obvious default works in one click.
    isCollabActive() ? readCurrentRoom() ?? projectId : projectId,
  );
  const [status, setStatus] = useState<Status>(
    isCollabActive() ? 'connected' : 'idle',
  );
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<ConnectedInfo | null>(null);
  const [identity, setIdentity] = useState<{ name: string; color: string } | null>(null);

  // If we're already connected when the modal opens, hydrate the
  // peer list so the user sees who's present without having to
  // reconnect.
  useEffect(() => {
    if (!isCollabActive() || !isCollabLoaded()) return;
    let cancelled = false;
    void (async () => {
      const mod = await loadCollab();
      if (cancelled) return;
      const id = mod.getLocalIdentity();
      setIdentity({ name: id.name, color: id.color });
      const room = mod.activeRoom();
      if (room) {
        const unsub = mod.onRemotePresence((states) => {
          setInfo({
            room,
            peers: states.map((s) => ({ userId: s.userId, name: s.name, color: s.color })),
          });
        });
        return () => unsub();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onJoin = async () => {
    const trimmed = room.trim();
    if (!trimmed) {
      setError('Room code is required');
      return;
    }
    setStatus('loading');
    setError(null);
    try {
      const mod = await loadCollab();
      const store = useStore as unknown as Parameters<typeof mod.startSession>[0]['store'];
      const session = mod.startSession({ room: trimmed, store });
      setCollabActive(true);
      setIdentity({ name: session.identity.name, color: session.identity.color });
      mod.onRemotePresence((states) => {
        setInfo({
          room: trimmed,
          peers: states.map((s) => ({ userId: s.userId, name: s.name, color: s.color })),
        });
      });
      setStatus('connected');
      useStore.getState().setStatus(`Collab: joined room ${trimmed}`);
    } catch (err) {
      setStatus('error');
      setError((err as Error).message);
    }
  };

  const onDisconnect = async () => {
    if (!isCollabLoaded()) return;
    const mod = await loadCollab();
    mod.stopSession();
    setCollabActive(false);
    setStatus('idle');
    setInfo(null);
    useStore.getState().setStatus('Collab: disconnected');
  };

  const shareableLink = (() => {
    if (typeof window === 'undefined') return '';
    const base = window.location.origin + window.location.pathname;
    return `${base}#collab=${encodeURIComponent(room.trim())}`;
  })();

  const onCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareableLink);
      useStore.getState().setStatus('Collab link copied to clipboard');
    } catch {
      // Clipboard API can fail in non-secure contexts — fall back to a prompt.
      window.prompt('Copy this link', shareableLink);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        style={{ minWidth: 480, maxWidth: 560 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          Collaboration
          <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--text-mute)' }}>
            BETA
          </span>
          <span className="close" onClick={onClose} style={{ marginLeft: 'auto' }}>
            ×
          </span>
        </div>
        <div className="modal-body">
          <p style={{ marginBottom: 12, color: 'var(--text-dim)', fontSize: 13, lineHeight: 1.5 }}>
            Live cursors and shared editing for <strong>{projectName}</strong>. Anyone with
            the room code below can join and edit. Connection is peer-to-peer — no
            account or backend required.
          </p>

          <label
            style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-mute)', marginBottom: 4, letterSpacing: 0.5 }}
          >
            Room code
          </label>
          <input
            type="text"
            value={room}
            disabled={status === 'connected' || status === 'loading'}
            onChange={(e) => setRoom(e.target.value)}
            style={{
              width: '100%',
              padding: '8px 10px',
              fontSize: 14,
              fontFamily: 'monospace',
              background: 'var(--bg-2)',
              border: '1px solid var(--border)',
              borderRadius: 4,
              color: 'var(--text)',
              marginBottom: 12,
            }}
            placeholder="my-shared-project"
          />

          {status === 'connected' && (
            <div
              style={{
                background: 'var(--bg-2)',
                border: '1px solid var(--border)',
                padding: 10,
                borderRadius: 4,
                marginBottom: 12,
                fontSize: 12,
              }}
            >
              <div style={{ marginBottom: 8, color: 'var(--text-dim)' }}>
                Shareable link
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input
                  type="text"
                  value={shareableLink}
                  readOnly
                  style={{
                    flex: 1,
                    padding: '4px 8px',
                    fontSize: 11,
                    fontFamily: 'monospace',
                    background: 'var(--bg-1)',
                    border: '1px solid var(--border)',
                    borderRadius: 3,
                    color: 'var(--text)',
                  }}
                />
                <button className="btn-ghost" onClick={onCopyLink}>
                  Copy
                </button>
              </div>
            </div>
          )}

          {identity && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                marginBottom: 12,
                fontSize: 12,
              }}
            >
              <div
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  background: identity.color,
                  border: '1px solid var(--border)',
                }}
              />
              <span style={{ color: 'var(--text-dim)' }}>You are</span>
              <strong>{identity.name}</strong>
            </div>
          )}

          {status === 'connected' && info && (
            <div>
              <div
                style={{
                  fontSize: 11,
                  textTransform: 'uppercase',
                  color: 'var(--text-mute)',
                  letterSpacing: 0.5,
                  marginBottom: 6,
                }}
              >
                Connected peers ({info.peers.length})
              </div>
              {info.peers.length === 0 ? (
                <div style={{ fontSize: 12, color: 'var(--text-mute)' }}>
                  Waiting for someone to join…
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {info.peers.map((p) => (
                    <div key={p.userId} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                      <div
                        style={{
                          width: 10,
                          height: 10,
                          borderRadius: '50%',
                          background: p.color,
                          border: '1px solid var(--border)',
                        }}
                      />
                      <span>{p.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {error && (
            <div
              style={{
                marginTop: 12,
                padding: 8,
                background: 'rgba(255,80,80,0.1)',
                border: '1px solid rgba(255,80,80,0.3)',
                borderRadius: 4,
                fontSize: 12,
                color: '#ff8080',
              }}
            >
              {error}
            </div>
          )}

          <div
            style={{
              marginTop: 16,
              padding: 10,
              background: 'rgba(255,200,80,0.06)',
              border: '1px solid rgba(255,200,80,0.2)',
              borderRadius: 4,
              fontSize: 11,
              color: 'var(--text-dim)',
              lineHeight: 1.5,
            }}
          >
            <strong style={{ color: 'var(--text)' }}>MVP notice:</strong> no
            authentication, no permissions. Anyone with the room code can join and
            edit. Concurrent edits resolve at the project level (last writer wins);
            fine-grained CRDT merging is planned.
          </div>
        </div>
        <div className="modal-footer">
          {status === 'connected' ? (
            <>
              <button className="btn-ghost" onClick={onDisconnect}>
                Disconnect
              </button>
              <button className="btn-primary" onClick={onClose}>
                Done
              </button>
            </>
          ) : (
            <>
              <button className="btn-ghost" onClick={onClose}>
                Cancel
              </button>
              <button
                className="btn-primary"
                onClick={onJoin}
                disabled={status === 'loading'}
              >
                {status === 'loading' ? 'Connecting…' : 'Join / Start session'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Read the active room without forcing the collab chunk to load.
// Returns null if the chunk hasn't been imported yet.
function readCurrentRoom(): string | null {
  if (!isCollabLoaded()) return null;
  // Once loaded, the import() promise has already resolved; getModule
  // grabs the cached module synchronously through the dynamic import
  // cache (Vite/ESM caches resolved modules).
  // We can't call activeRoom() synchronously here, so we accept the
  // loose null return for the "first render before useEffect" path —
  // the useEffect below will hydrate the room shortly after.
  return null;
}
