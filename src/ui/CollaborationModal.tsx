import React, { useEffect, useState } from 'react';
import { useStore } from '../state/store';
import {
  loadCollab,
  isCollabLoaded,
  isActive as isCollabActive,
  activeRoom as activeCollaborationRoom,
  _setActive as setCollabActive,
  collaborationRuntimeConfiguration,
} from '../collab/runtime';
import {
  assertSecureCollaborationRoomCode,
  collaborationRoomCodeFromHash,
  generateCollaborationRoomCode,
} from '../collab/room-code';

type Status = 'idle' | 'loading' | 'connected' | 'error';
type CollaborationMode = 'authenticated' | 'anonymous-beta';

// Tracks the most recent presence snapshot and peer count so the
// modal can render "Connected to N peers" without re-importing the
// session module every render.
interface ConnectedInfo {
  room: string;
  peers: { userId: string; name: string; color: string }[];
}

export function CollaborationModal({ onClose }: { onClose: () => void }) {
  const projectName = useStore((s) => s.project.name);
  const config = collaborationRuntimeConfiguration();
  const available = Boolean(config.authenticatedEndpoint) || config.anonymousBetaEnabled;

  const [room, setRoom] = useState<string>(() =>
    activeCollaborationRoom()
      ?? collaborationRoomCodeFromHash(typeof window === 'undefined' ? '' : window.location.hash)
      ?? generateCollaborationRoomCode(),
  );
  const [status, setStatus] = useState<Status>(
    isCollabActive() ? 'connected' : 'idle',
  );
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<ConnectedInfo | null>(null);
  const [mode, setMode] = useState<CollaborationMode>(
    config.authenticatedEndpoint ? 'authenticated' : 'anonymous-beta',
  );
  const [identity, setIdentity] = useState<{
    name: string;
    color: string;
    role: 'owner' | 'editor' | 'viewer';
    email?: string;
  } | null>(null);
  const [readOnly, setReadOnly] = useState(false);

  // If we're already connected when the modal opens, hydrate the
  // peer list so the user sees who's present without having to
  // reconnect.
  useEffect(() => {
    if (!isCollabActive() || !isCollabLoaded()) return;
    let cancelled = false;
    void (async () => {
      const mod = await loadCollab();
      if (cancelled) return;
      const id = mod.activeIdentity();
      if (id) {
        setIdentity(id);
        setReadOnly(id.role === 'viewer');
      }
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
    try {
      assertSecureCollaborationRoomCode(trimmed);
    } catch (validationError) {
      setError((validationError as Error).message);
      return;
    }
    setStatus('loading');
    setError(null);
    try {
      const mod = await loadCollab();
      const store = useStore as unknown as Parameters<typeof mod.startSession>[0]['store'];
      const connection = mode === 'authenticated'
        ? config.authenticatedEndpoint
          ? { kind: 'authenticated' as const, endpoint: config.authenticatedEndpoint }
          : null
        : config.anonymousBetaEnabled
          ? { kind: 'anonymous-beta' as const }
          : null;
      if (!connection) throw new Error('This collaboration transport is not enabled in this build');
      const session = await mod.startSession({ room: trimmed, store, connection });
      setCollabActive(true);
      setIdentity(session.identity);
      setReadOnly(session.readOnly);
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
    setIdentity(null);
    setReadOnly(false);
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
            Live cursors and shared editing for <strong>{projectName}</strong>.{' '}
            {mode === 'authenticated'
              ? 'Cloudflare Access authenticates every connection and the room enforces owner, editor and viewer roles.'
              : 'Anonymous beta mode is peer-to-peer; anyone with the room link can read and edit.'}
          </p>

          {!available && (
            <div style={{ marginBottom: 12, padding: 10, border: '1px solid var(--border)', borderRadius: 4, fontSize: 12 }}>
              Collaboration is disabled in this build. Configure an authenticated backend,
              or explicitly enable the anonymous beta for local evaluation.
            </div>
          )}

          {config.authenticatedEndpoint && config.anonymousBetaEnabled && status !== 'connected' && (
            <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
              <button
                className={mode === 'authenticated' ? 'btn-primary' : 'btn-ghost'}
                disabled={status === 'loading'}
                onClick={() => setMode('authenticated')}
              >
                Authenticated
              </button>
              <button
                className={mode === 'anonymous-beta' ? 'btn-primary' : 'btn-ghost'}
                disabled={status === 'loading'}
                onClick={() => setMode('anonymous-beta')}
              >
                Anonymous beta
              </button>
            </div>
          )}

          <label
            style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', color: 'var(--text-mute)', marginBottom: 4, letterSpacing: 0.5 }}
          >
            Room code
          </label>
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
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
              }}
              placeholder="oc_…"
            />
            <button
              className="btn-ghost"
              disabled={status === 'connected' || status === 'loading'}
              onClick={() => {
                setRoom(generateCollaborationRoomCode());
                setError(null);
              }}
            >
              New
            </button>
          </div>

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
              <span style={{ color: 'var(--text-mute)' }}>({identity.role})</span>
            </div>
          )}

          {status === 'connected' && readOnly && (
            <div style={{ marginBottom: 12, padding: 8, border: '1px solid var(--border)', borderRadius: 4, fontSize: 12 }}>
              This is a read-only viewer session. The server rejects document updates from this role.
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
            {mode === 'authenticated' ? (
              <>
                <strong style={{ color: 'var(--text)' }}>Authenticated mode:</strong>{' '}
                Cloudflare Access identity is verified again by the Worker. Room state is
                persisted by a per-room Durable Object; viewers cannot write.
              </>
            ) : (
              <>
                <strong style={{ color: 'var(--text)' }}>Anonymous beta:</strong> no
                authentication or role enforcement. Anyone with the room link can read
                and edit. Do not use this mode for sensitive projects.
              </>
            )}
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
                disabled={status === 'loading' || !available}
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
