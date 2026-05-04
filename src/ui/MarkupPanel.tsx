import React, { useMemo, useState } from 'react';
import { useStore } from '../state/store';
import { nanoid } from 'nanoid';
import type { MarkupItem } from '../models/revision';

type FilterStatus = 'all' | 'open' | 'resolved';

export function MarkupPanel() {
  const project = useStore((s) => s.project);
  const setProject = useStore((s) => s.setProject);
  const setViewport = useStore((s) => s.setViewport);
  const editor = useStore((s) => s.editor);

  const [filter, setFilter] = useState<FilterStatus>('open');
  const [replyFor, setReplyFor] = useState<string | null>(null);
  const [replyText, setReplyText] = useState('');

  const markups = project.markups ?? {};
  const sheetId = project.activeSheetId;

  const onSheet = useMemo(() => {
    return Object.values(markups).filter((m) => m.sheetId === sheetId);
  }, [markups, sheetId]);

  const visible = useMemo(() => {
    return onSheet.filter((m) => {
      if (filter === 'all') return true;
      if (filter === 'open') return m.status === 'open';
      return m.status !== 'open';
    });
  }, [onSheet, filter]);

  const upsert = (m: MarkupItem) => {
    setProject({ ...project, markups: { ...markups, [m.id]: m }, modified: Date.now() });
  };

  const onAdd = () => {
    const text = window.prompt('Comment text?');
    if (!text) return;
    const author = window.prompt('Your name?') ?? 'You';
    const m: MarkupItem = {
      id: nanoid(10),
      sheetId,
      kind: 'comment',
      text,
      author,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: 'open',
      anchorPoint: { x: editor.cursor.x, y: editor.cursor.y },
    };
    upsert(m);
  };

  const onReply = (m: MarkupItem) => {
    if (!replyText.trim()) {
      setReplyFor(null);
      return;
    }
    const next: MarkupItem = {
      ...m,
      replies: [
        ...(m.replies ?? []),
        { id: nanoid(10), author: 'You', text: replyText, createdAt: Date.now() },
      ],
      updatedAt: Date.now(),
    };
    upsert(next);
    setReplyFor(null);
    setReplyText('');
  };

  const onResolve = (m: MarkupItem) => {
    upsert({ ...m, status: 'resolved', resolvedAt: Date.now(), resolvedBy: 'You', updatedAt: Date.now() });
  };

  const onReopen = (m: MarkupItem) => {
    upsert({ ...m, status: 'open', resolvedAt: undefined, resolvedBy: undefined, updatedAt: Date.now() });
  };

  const navigate = (m: MarkupItem) => {
    if (!m.anchorPoint) return;
    setViewport({ ...editor.viewport, x: m.anchorPoint.x - 100, y: m.anchorPoint.y - 100 });
  };

  return (
    <div className="markup-panel">
      <div className="markup-panel-header">
        <span>Markups</span>
        <div className="markup-panel-actions">
          <select value={filter} onChange={(e) => setFilter(e.target.value as FilterStatus)}>
            <option value="all">All</option>
            <option value="open">Open</option>
            <option value="resolved">Resolved</option>
          </select>
          <button className="btn-ghost btn-tiny" onClick={onAdd}>+ Markup</button>
        </div>
      </div>
      <div className="markup-list">
        {visible.length === 0 && (
          <div className="markup-empty">No markups on this sheet.</div>
        )}
        {visible.map((m) => (
          <div key={m.id} className={`markup-item status-${m.status}`}>
            <div className="markup-head">
              <span className="markup-author">{m.author}</span>
              <span className={`markup-status status-${m.status}`}>{m.status}</span>
              <span className="markup-spacer" />
              <button
                className="btn-ghost btn-tiny"
                onClick={() => navigate(m)}
                title="Pan to anchor"
              >Goto</button>
            </div>
            <div className="markup-body">{m.text}</div>
            {m.replies && m.replies.length > 0 && (
              <div className="markup-replies">
                {m.replies.map((r) => (
                  <div key={r.id} className="markup-reply">
                    <strong>{r.author}:</strong> {r.text}
                  </div>
                ))}
              </div>
            )}
            {replyFor === m.id ? (
              <div className="markup-reply-form">
                <input
                  autoFocus
                  value={replyText}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder="Reply…"
                />
                <button className="btn-ghost btn-tiny" onClick={() => onReply(m)}>Send</button>
                <button className="btn-ghost btn-tiny" onClick={() => { setReplyFor(null); setReplyText(''); }}>Cancel</button>
              </div>
            ) : (
              <div className="markup-actions">
                <button className="btn-ghost btn-tiny" onClick={() => setReplyFor(m.id)}>Reply</button>
                {m.status === 'open' ? (
                  <button className="btn-ghost btn-tiny" onClick={() => onResolve(m)}>Resolve</button>
                ) : (
                  <button className="btn-ghost btn-tiny" onClick={() => onReopen(m)}>Reopen</button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
