import { describe, expect, it } from 'vitest';
import { isValidElement } from 'react';
import { ErrorBoundary, backupFilename } from '../ErrorBoundary';

describe('backupFilename', () => {
  it('collapses whitespace and keeps the .opencad.json extension', () => {
    expect(backupFilename('Corporate HQ  Building')).toBe('Corporate_HQ_Building_backup.opencad.json');
  });

  it('falls back to "project" for empty or whitespace-only names', () => {
    expect(backupFilename('')).toBe('project_backup.opencad.json');
    expect(backupFilename('   ')).toBe('project_backup.opencad.json');
  });
});

describe('ErrorBoundary', () => {
  it('derives error state from a thrown error', () => {
    const err = new Error('boom');
    expect(ErrorBoundary.getDerivedStateFromError(err)).toEqual({ error: err });
  });

  it('renders children untouched while no error is recorded', () => {
    const boundary = new ErrorBoundary({ label: 'Test region', children: 'children-marker' });
    expect(boundary.render()).toBe('children-marker');
  });

  it('renders the fallback with the region label and extra class once errored', () => {
    const boundary = new ErrorBoundary({
      label: 'Test region',
      className: 'error-fallback-fill',
      children: 'children-marker',
    });
    boundary.state = { error: new Error('boom') };
    const tree = boundary.render();
    if (!isValidElement<{ className: string; role: string }>(tree)) {
      throw new Error('expected a fallback element');
    }
    expect(tree.props.role).toBe('alert');
    expect(tree.props.className).toBe('error-fallback error-fallback-fill');
    // The fallback must name the crashed region and the raw error message.
    // (JSX splits `{label} crashed` into separate text children.)
    const html = JSON.stringify(tree);
    expect(html).toContain('Test region');
    expect(html).toContain(' crashed');
    expect(html).toContain('boom');
  });
});
