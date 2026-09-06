import type { CSSProperties } from 'react';

const paths = {
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  chevron: <path d="m8 10 4 4 4-4" />,
  undo: <path d="m8 5-5 5 5 5M3 10h12a5 5 0 0 1 0 10h-3" />,
  redo: <path d="m16 5 5 5-5 5M21 10H9a5 5 0 0 0 0 10h3" />,
  split: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M12 4v16" /></>,
  sidebar: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>,
  inspector: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></>,
  focus: <path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6" />,
  more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  app: <><path d="m3 7 9-4 9 4v10l-9 4-9-4ZM3 7l9 4 9-4M12 11v10" /></>,
};

export function AppIcon({ name, size = 18, style }: { name: keyof typeof paths; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}>{paths[name]}</svg>;
}
