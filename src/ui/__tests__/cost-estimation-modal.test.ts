import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CostWarnings } from '../CostEstimationModal';

describe('CostWarnings', () => {
  it('renders nothing without warnings', () => {
    expect(renderToStaticMarkup(createElement(CostWarnings, { warnings: [] }))).toBe('');
  });

  it('discloses unpriced items that are excluded from the total', () => {
    const html = renderToStaticMarkup(
      createElement(CostWarnings, { warnings: ['Not priced, excluded from material total: 4 x bend — 90 deg <b>'] }),
    );
    expect(html).toContain('Total is incomplete (1)');
    expect(html).toContain('Not priced, excluded from material total: 4 x bend');
    expect(html).toContain('&lt;b&gt;');
  });
});
