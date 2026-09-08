import { useRef, useState } from 'react';

/** A completed edit makes one undo entry; typing never changes the model. */
export function DimensionInput({ label, value, unit = 'mm', disabled, onCommit }: {
  label: string; value: number; unit?: string; disabled?: boolean; onCommit: (value: number) => boolean | void;
}) {
  const display = Number(value.toFixed(2)).toString();
  const [draft, setDraft] = useState<string | null>(null);
  const cancelled = useRef(false);
  return <label className="scene-dimension-field"><span>{label}</span><span className="scene-dimension-value">
    <input aria-label={label} inputMode="decimal" value={draft ?? display} disabled={disabled}
      onFocus={event => { setDraft(display); event.currentTarget.select(); }} onChange={event => setDraft(event.target.value)}
      onBlur={() => {
        if (cancelled.current) { cancelled.current = false; setDraft(null); return; }
        const number = draft == null || draft.trim() === '' ? Number.NaN : Number(draft);
        if (draft !== display && number !== value && Number.isFinite(number)) onCommit(number);
        setDraft(null);
      }}
      onKeyDown={event => {
        if (event.key === 'Enter') { event.preventDefault(); event.currentTarget.blur(); }
        if (event.key === 'Escape') {
          event.preventDefault(); event.stopPropagation(); cancelled.current = true; event.currentTarget.blur();
        }
      }} />
    <span>{unit}</span>
  </span></label>;
}
