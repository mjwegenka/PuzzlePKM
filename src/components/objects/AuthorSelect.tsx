import { cn } from 'aslan-ui';
import * as React from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Check, ChevronDown, Loader2, Plus, Trash2, X } from 'lucide-react';
import type { AuthorSummary } from '@/lib/cliService';

interface AuthorSelectProps {
  value: string;
  onChange: (value: string) => void;
  authors: AuthorSummary[];
  loading?: boolean;
  onCreateAuthor: (name: string) => Promise<void>;
  onDeleteAuthor: (name: string) => Promise<void>;
  disabled?: boolean;
}

export function AuthorSelect({
  value,
  onChange,
  authors,
  loading = false,
  onCreateAuthor,
  onDeleteAuthor,
  disabled = false,
}: AuthorSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [inputValue, setInputValue] = React.useState('');
  const [deletingName, setDeletingName] = React.useState<string | null>(null);
  const [creatingNew, setCreatingNew] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const filtered = React.useMemo(() => {
    const q = inputValue.trim().toLowerCase();
    if (!q) return authors;
    return authors.filter((a) => a.name.toLowerCase().includes(q));
  }, [authors, inputValue]);

  const showCreate = React.useMemo(() => {
    const q = inputValue.trim();
    if (!q) return false;
    return !authors.some((a) => a.name.toLowerCase() === q.toLowerCase());
  }, [authors, inputValue]);

  function handleOpen(nextOpen: boolean) {
    setOpen(nextOpen);
    if (nextOpen) {
      setInputValue('');
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }

  function handleSelect(name: string) {
    onChange(name === value ? '' : name);
    setOpen(false);
    setInputValue('');
  }

  async function handleCreate() {
    const name = inputValue.trim();
    if (!name || creatingNew) return;
    setCreatingNew(true);
    try {
      await onCreateAuthor(name);
      onChange(name);
      setOpen(false);
      setInputValue('');
    } finally {
      setCreatingNew(false);
    }
  }

  async function handleDelete(e: React.MouseEvent, name: string) {
    e.stopPropagation();
    if (deletingName) return;
    setDeletingName(name);
    try {
      await onDeleteAuthor(name);
      if (value === name) onChange('');
    } finally {
      setDeletingName(null);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (showCreate) {
        void handleCreate();
      } else if (filtered.length === 1) {
        handleSelect(filtered[0].name);
      }
    }
    if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange('');
  }

  return (
    <Popover.Root open={open} onOpenChange={handleOpen}>
      <Popover.Trigger asChild disabled={disabled}>
        <button
          type="button"
          className={cn(
            'flex h-10 w-full items-center justify-between rounded-[10px] border border-input',
            'bg-[var(--color-surface-control)]/88 px-3.5 py-2 text-sm shadow-none outline-none',
            'transition-[background-color,border-color,color,box-shadow]',
            'focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/45',
            'disabled:cursor-not-allowed disabled:opacity-50',
            !value && 'text-muted-foreground',
          )}
        >
          <span className="truncate">{value || 'Select or add author…'}</span>
          <span className="ml-2 flex shrink-0 items-center gap-1">
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin opacity-50" />}
            {value && !loading && (
              <span
                role="button"
                tabIndex={-1}
                aria-label="Clear author"
                className="flex items-center rounded p-0.5 opacity-50 hover:opacity-100"
                onClick={handleClear}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChange(''); } }}
              >
                <X className="h-3.5 w-3.5" />
              </span>
            )}
            <ChevronDown className="h-4 w-4 opacity-50" />
          </span>
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          sideOffset={4}
          align="start"
          className={cn(
            'z-50 w-[var(--radix-popover-trigger-width)] min-w-[200px] rounded-[12px]',
            'border bg-popover text-popover-foreground shadow-md',
            'overflow-hidden',
          )}
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {/* Search / create input */}
          <div className="flex items-center border-b border-[var(--color-border-subtle)] px-3 py-2">
            <input
              ref={inputRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search or add author…"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          {/* Author list */}
          <div className="max-h-56 overflow-y-auto p-1">
            {loading && filtered.length === 0 && (
              <div className="flex items-center justify-center py-6 text-xs text-[var(--color-text-secondary)]">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading…
              </div>
            )}

            {!loading && filtered.length === 0 && !showCreate && (
              <div className="py-6 text-center text-xs text-[var(--color-text-secondary)]">
                No authors found
              </div>
            )}

            {filtered.map((author) => {
              const isSelected = value === author.name;
              const isDeleting = deletingName === author.name;
              const canDelete = author.usageCount === 0;

              return (
                <div
                  key={author.name}
                  onClick={() => handleSelect(author.name)}
                  className={cn(
                    'group flex w-full cursor-pointer items-center gap-2 rounded-[10px] px-2 py-1.5 text-sm',
                    'outline-none hover:bg-accent focus:bg-accent',
                    isSelected && 'bg-accent',
                  )}
                >
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center text-[var(--color-accent-metadata)]">
                    {isSelected && <Check className="h-4 w-4" />}
                  </span>
                  <span className="flex-1 truncate">{author.name}</span>
                  {author.usageCount > 0 && (
                    <span className="shrink-0 text-xs text-[var(--color-text-secondary)]">
                      {author.usageCount}
                    </span>
                  )}
                  <button
                    type="button"
                    aria-label={
                      canDelete
                        ? `Delete author ${author.name}`
                        : `Cannot delete: ${author.usageCount} reference(s)`
                    }
                    disabled={!canDelete || isDeleting}
                    onClick={(e) => { void handleDelete(e, author.name); }}
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] opacity-0 transition-opacity',
                      'group-hover:opacity-100',
                      canDelete
                        ? 'hover:bg-destructive/20 hover:text-destructive'
                        : 'cursor-not-allowed opacity-30',
                    )}
                  >
                    {isDeleting
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Trash2 className="h-3.5 w-3.5" />}
                  </button>
                </div>
              );
            })}

            {/* Create new author option */}
            {showCreate && (
              <div
                onClick={() => { void handleCreate(); }}
                className={cn(
                  'flex w-full cursor-pointer items-center gap-2 rounded-[10px] px-2 py-1.5 text-sm',
                  'outline-none hover:bg-accent focus:bg-accent',
                  creatingNew && 'pointer-events-none opacity-60',
                )}
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center text-[var(--color-accent-metadata)]">
                  {creatingNew ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                </span>
                <span className="flex-1 truncate">
                  Add <span className="font-medium">"{inputValue.trim()}"</span>
                </span>
              </div>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

