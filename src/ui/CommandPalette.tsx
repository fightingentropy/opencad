import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { runCommand } from '../lib/commands';
import { fitViewportToSheet } from '../lib/fit';
import {
  buildWorkspaceSearchIndex, rememberWorkspaceResult, searchWorkspace, workspaceTargetView,
  type WorkspaceSearchResult,
} from '../lib/workspace-search';
import { beginComponentPlacement, cancelComponentPlacement } from '../state/component-placement';
import { notify } from '../state/notifications';
import { useStore } from '../state/store';
import './command-palette.css';

function SearchResultIcon({ kind }: { kind: WorkspaceSearchResult['kind'] }) {
  return <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === 'component' ? <path d="M10 4v12M4 10h12" />
      : kind === 'sheet' ? <><path d="M5 2.5h6l4 4v11H5Z" /><path d="M11 2.5v4h4M8 10h4M8 13h4" /></>
      : kind === 'object' ? <><path d="m10 2.5 6.5 3.75v7.5L10 17.5l-6.5-3.75v-7.5Z" /><path d="m3.5 6.25 6.5 3.8 6.5-3.8M10 10v7.5" /></>
      : <><path d="m5 5 5 5-5 5M11 15h4" /></>}
  </svg>;
}

let navigationVersion = 0;

function navigateTo(result: Extract<WorkspaceSearchResult, { kind: 'object' | 'sheet' }>): void {
  cancelComponentPlacement();
  const version = ++navigationVersion;
  const store = useStore.getState();
  const sheet = store.project.sheets[result.sheetId];
  if (!sheet) return;
  const entity = result.kind === 'object' ? sheet.entities[result.entityId] : undefined;
  if (result.kind === 'object' && !entity) return;
  store.setTool('select');
  if (store.project.activeSheetId !== sheet.id) store.setActiveSheet(sheet.id);
  store.setSelection(entity ? [entity.id] : []);
  const use3D = entity && store.editor.viewMode !== '2d' && workspaceTargetView(store.project, sheet, entity) === '3d';
  if (!use3D) store.setViewMode('2d');

  const fitDrawing = (): void => {
    const current = useStore.getState();
    if (version !== navigationVersion || current.project.activeSheetId !== sheet.id) return;
    const canvas = document.querySelector<HTMLCanvasElement>('canvas.canvas-2d');
    const width = Math.max(240, canvas?.clientWidth ?? window.innerWidth - 320);
    const height = Math.max(200, canvas?.clientHeight ?? window.innerHeight - 160);
    const target = entity ? { ...sheet, entities: { [entity.id]: { ...entity, visible: true } }, entityOrder: [entity.id] } : sheet;
    current.setViewport(fitViewportToSheet(target, width, height, 90));
    const hidden = entity && (entity.visible === false || current.project.layers[entity.layerId]?.visible === false);
    current.setStatus(`${entity ? 'Located' : 'Opened'} ${result.title}${entity ? ` on ${sheet.name}` : ''}${hidden ? ' · Hidden in the drawing' : ''}`);
    if (hidden) notify('info', `Located ${result.title} on ${sheet.name}`, {
      detail: entity.visible === false ? 'This object is hidden in the drawing.' : `Its layer, ${current.project.layers[entity.layerId]?.name ?? 'unnamed'}, is hidden.`,
    });
  };

  // Sheet auto-fit and lazy viewer effects must finish before applying search focus.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!use3D || !entity) { fitDrawing(); return; }
    let focused = false;
    const deadline = performance.now() + 2500;
    const focus = (): void => {
      const current = useStore.getState();
      if (focused || version !== navigationVersion || current.project.activeSheetId !== sheet.id || !current.editor.selection.has(entity.id)) return;
      window.dispatchEvent(new CustomEvent('opencad:focus-entity', {
        detail: { entityId: entity.id, sheetId: sheet.id, isolate: false, onFocused: () => { focused = true; } },
      }));
      if (focused) return;
      if (performance.now() < deadline) requestAnimationFrame(focus);
      else {
        current.setViewMode('2d');
        requestAnimationFrame(() => requestAnimationFrame(fitDrawing));
      }
    };
    focus();
  }));
}

/** Unified keyboard search: run actions, add components, or locate project work. */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const project = useStore((state) => state.project);
  const selection = useStore((state) => state.editor.selection);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const paletteId = useId();
  const listId = `${paletteId}-results`;
  const index = useMemo(() => buildWorkspaceSearchIndex(project), [project, selection]);
  const results = useMemo(() => searchWorkspace(index, query), [index, query]);
  const activeIndex = Math.min(active, Math.max(0, results.length - 1));
  const activeResult = results[activeIndex];
  const optionId = (row: number): string => `${paletteId}-option-${row}`;

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    return () => {
      if (previousFocusRef.current?.isConnected) previousFocusRef.current.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    row?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, results]);

  const execute = (result: WorkspaceSearchResult): void => {
    rememberWorkspaceResult(result.id);
    onClose();
    if (result.kind === 'command') {
      if (result.command.id.startsWith('tool.')) useStore.getState().setViewMode('2d');
      runCommand(result.command.id);
    }
    else if (result.kind === 'component') requestAnimationFrame(() => beginComponentPlacement(result.component));
    else navigateTo(result);
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    event.stopPropagation();
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape' || ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k')) {
      event.preventDefault();
      onClose();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      if (results.length) setActive((activeIndex + direction + results.length) % results.length);
    } else if (event.key === 'PageDown' || event.key === 'PageUp') {
      event.preventDefault();
      setActive(Math.max(0, Math.min(results.length - 1, activeIndex + (event.key === 'PageDown' ? 6 : -6))));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (activeResult) execute(activeResult);
    } else if (event.key === 'Tab') {
      event.preventDefault();
      inputRef.current?.focus();
    }
  };

  return <div className="workspace-search-backdrop" role="presentation" onMouseDown={(event) => {
    if (event.target === event.currentTarget) onClose();
  }}>
    <div className="workspace-search-dialog" role="dialog" aria-modal="true" aria-label="Search workspace" onKeyDown={onKeyDown}>
      <div className="workspace-search-field">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 4.5 4.5" /></svg>
        <input ref={inputRef} role="combobox" aria-label="Search anything" aria-expanded="true" aria-controls={listId}
          aria-autocomplete="list" aria-activedescendant={activeResult ? optionId(activeIndex) : undefined}
          placeholder="Search anything…" autoComplete="off" spellCheck={false} value={query}
          onChange={(event) => { setQuery(event.target.value); setActive(0); }} />
        <kbd aria-hidden="true">esc</kbd>
      </div>
      {!query.trim() && <div className="workspace-search-heading">Suggestions</div>}
      <div className="workspace-search-results" id={listId} role="listbox" aria-label="Search results" ref={listRef}>
        {results.map((result, row) => <div key={result.id} id={optionId(row)} role="option" aria-selected={row === activeIndex}
          className={`workspace-search-result${row === activeIndex ? ' is-active' : ''}`}
          onMouseDown={(event) => event.preventDefault()} onMouseMove={() => setActive(row)} onClick={() => execute(result)}>
          <span className="workspace-search-icon"><SearchResultIcon kind={result.kind} /></span>
          <span className="workspace-search-copy"><span className="workspace-search-title">{result.title}</span>
            {result.detail && <span className="workspace-search-detail">{result.detail}</span>}</span>
          {result.kind === 'command' && result.command.shortcut ? <kbd className="workspace-search-shortcut">{result.command.shortcut.display}</kbd>
            : <span className="workspace-search-action">{result.kind === 'component' ? 'Add' : result.kind === 'command' ? 'Run' : result.kind === 'sheet' ? 'Open' : 'Go to'}</span>}
        </div>)}
        {!results.length && <div className="workspace-search-empty"><strong>No results for “{query}”</strong><span>Try a component, command, tag or part number.</span></div>}
      </div>
      <div className="workspace-search-footer"><span>{query.trim() ? `${results.length} result${results.length === 1 ? '' : 's'}` : 'Commands, components and your project'}</span>
        <span><kbd>↑</kbd><kbd>↓</kbd> navigate <kbd>↵</kbd> {activeResult?.kind === 'component' ? 'add' : 'select'}</span></div>
      <span className="workspace-search-announcement" role="status" aria-live="polite">{query.trim() ? `${results.length} results` : ''}</span>
    </div>
  </div>;
}
