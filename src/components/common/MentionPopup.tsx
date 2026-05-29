import React, { useEffect, useRef } from 'react';
import { getObjectColor } from '../../lib/objectColors';
import { withAlpha } from '../../lib/colorUtils';

export interface MentionOption {
  id: string;
  type: string;
  title: string;
  date?: string;
  syncPath?: string;
  /** True for synthetic "create new daily note" options. */
  isNew?: boolean;
}

interface MentionPopupProps {
  query: string;
  options: MentionOption[];
  selectedIndex: number;
  onSelect: (option: MentionOption) => void;
  onClose: () => void;
  position: { top: number; left: number } | null;
}

const TYPE_LABELS: Record<string, string> = {
  'daily-note': 'daily',
  'topic-note': 'note',
  'project': 'project',
  'ref-material': 'ref',
}

export default function MentionPopup({
  query,
  options,
  selectedIndex,
  onSelect,
  onClose,
  position,
}: MentionPopupProps) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!listRef.current) return;
    const item = listRef.current.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  useEffect(() => {
    if (!position) return;
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [position, onClose]);

  if (!position) return null;

  const maxWidth = 340;
  const leftAdjusted = Math.min(position.left, window.innerWidth - maxWidth - 8);

  return (
    <div
      className="fixed z-[9999] flex max-h-[260px] flex-col overflow-hidden rounded-[12px] border border-[var(--color-border-subtle)] bg-[var(--color-surface-app)] shadow-[0_8px_32px_rgba(0,0,0,0.7)]"
      style={{ top: position.top, left: leftAdjusted, width: maxWidth }}
    >
      <div className="shrink-0 border-b border-[var(--color-border-subtle)] px-3 py-2">
        <p className="text-sm text-[var(--color-text-secondary)]">
          {query ? `Searching for "${query}"…` : 'Link to object — type to filter'}
        </p>
      </div>

      {options.length === 0 ? (
        <div className="px-3 py-3">
          <p className="text-xs text-[var(--color-text-secondary)]">
            {query.length === 0 ? 'Searching all objects…' : `No matches for "${query}"`}
          </p>
        </div>
      ) : (
        <div ref={listRef} className="flex-1 overflow-auto p-1.5">
          {options.slice(0, 8).map((option, idx) => {
            const color = getObjectColor(option.type).accent;
            const label = TYPE_LABELS[option.type] ?? option.type;
            const isNew = option.isNew === true;
            return (
              <button
                type="button"
                key={`${option.type}-${option.id}-${idx}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={() => onSelect(option)}
                className="mb-1 flex w-full items-center gap-2 rounded-[8px] px-2 py-2 text-left transition-colors last:mb-0 hover:bg-[rgba(227,179,65,0.14)]"
                style={{ backgroundColor: idx === selectedIndex ? 'var(--color-selected-fill-soft)' : undefined }}
              >
                <span
                  className="shrink-0 rounded-[6px] border px-2 py-1 text-xs font-bold uppercase tracking-[0.04em]"
                  style={{
                    backgroundColor: withAlpha(color, isNew ? 0.22 : 0.14),
                    color,
                    borderColor: withAlpha(color, isNew ? 0.5 : 0.34),
                  }}
                >
                  {isNew ? `+ ${label}` : label}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm text-[var(--color-text-primary)]">
                  {option.title || '(untitled)'}
                </span>
                {option.date && ['daily-note', 'habit', 'project'].includes(option.type) && (
                  <span className="ml-1 shrink-0 text-xs text-[var(--color-text-secondary)]">
                    {option.date}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

      <div className="flex shrink-0 gap-2 border-t border-[var(--color-border-subtle)] px-3 py-2">
        <p className="text-xs text-[var(--color-text-disabled)]">
          ↑↓ navigate · Enter select · Esc close
        </p>
      </div>
    </div>
  )
}
