import React, { useEffect, useRef } from 'react';
import { Box, Paper, List, ListItem, ListItemButton, Typography } from '@mui/material';

export interface MentionOption {
  id: string;
  type: string;
  title: string;
  date?: string;
  dropboxPath?: string;
}

interface MentionPopupProps {
  query: string;
  options: MentionOption[];
  selectedIndex: number;
  onSelect: (option: MentionOption) => void;
  onClose: () => void;
  position: { top: number; left: number } | null;
}

const TYPE_COLORS: Record<string, string> = {
  'daily-note': '#1a8ab5',
  'topic-note': '#2aa876',
  'project': '#c8832a',
  'ref-material': '#9c6dd4',
};

const TYPE_LABELS: Record<string, string> = {
  'daily-note': 'daily',
  'topic-note': 'note',
  'project': 'project',
  'ref-material': 'ref',
};

export default function MentionPopup({
  query,
  options,
  selectedIndex,
  onSelect,
  onClose,
  position,
}: MentionPopupProps) {
  const listRef = useRef<HTMLUListElement>(null);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const item = listRef.current.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  // Close on Escape key (fallback — ObjectEditor also handles this on the textarea)
  useEffect(() => {
    if (!position) return;
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [position, onClose]);

  // Position being set means mention is active — always show when position is set
  if (!position) return null;


  // Keep popup within viewport bounds
  const maxWidth = 340;
  const leftAdjusted = Math.min(
    position.left,
    window.innerWidth - maxWidth - 8,
  );

  return (
    <Paper
      elevation={8}
      sx={{
        position: 'fixed',
        top: position.top,
        left: leftAdjusted,
        zIndex: 9999,
        width: maxWidth,
        maxHeight: 260,
        display: 'flex',
        flexDirection: 'column',
        bgcolor: '#0a1929',
        border: '1px solid #1c3558',
        borderRadius: '6px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.7)',
        overflow: 'hidden',
      }}
    >
      {/* Search header */}
      <Box sx={{ px: 1.5, py: 0.75, borderBottom: '1px solid #1c3558', flexShrink: 0 }}>
        <Typography variant="caption" sx={{ color: '#7dbad6', fontSize: '11px' }}>
          {query ? `Searching for "${query}"…` : 'Link to object — type to filter'}
        </Typography>
      </Box>

      {options.length === 0 ? (
        <Box sx={{ px: 1.5, py: 1.5 }}>
          <Typography variant="caption" sx={{ color: '#7dbad6' }}>
            {query.length === 0 ? 'Searching all objects…' : `No matches for "${query}"`}
          </Typography>
        </Box>
      ) : (
        <List ref={listRef} sx={{ p: 0.5, overflow: 'auto', flex: 1 }}>
          {options.slice(0, 8).map((option, idx) => {
            const color = TYPE_COLORS[option.type] ?? '#7dbad6';
            const label = TYPE_LABELS[option.type] ?? option.type;
            return (
              <ListItem key={`${option.type}-${option.id}-${idx}`} disablePadding>
                <ListItemButton
                  selected={idx === selectedIndex}
                  dense
                  onClick={() => onSelect(option)}
                  sx={{
                    borderRadius: '4px',
                    gap: 1,
                    '&.Mui-selected': {
                      bgcolor: 'rgba(26,138,181,0.22)',
                    },
                    '&:hover': {
                      bgcolor: 'rgba(26,138,181,0.15)',
                    },
                  }}
                >
                  {/* Type badge */}
                  <Box
                    sx={{
                      flexShrink: 0,
                      fontSize: '9px',
                      fontWeight: 700,
                      letterSpacing: '0.04em',
                      px: 0.75,
                      py: 0.25,
                      borderRadius: '3px',
                      bgcolor: `${color}22`,
                      color,
                      border: `1px solid ${color}55`,
                      textTransform: 'uppercase',
                    }}
                  >
                    {label}
                  </Box>

                  {/* Title */}
                  <Typography
                    variant="body2"
                    sx={{
                      flex: 1,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      fontSize: '13px',
                    }}
                  >
                    {option.title || '(untitled)'}
                  </Typography>
                </ListItemButton>
              </ListItem>
            );
          })}
        </List>
      )}

      {/* Footer hint */}
      <Box
        sx={{
          px: 1.5,
          py: 0.5,
          borderTop: '1px solid #1c3558',
          flexShrink: 0,
          display: 'flex',
          gap: 2,
        }}
      >
        <Typography variant="caption" sx={{ color: '#4a6a8a', fontSize: '10px' }}>
          ↑↓ navigate · Enter select · Esc close
        </Typography>
      </Box>
    </Paper>
  );
}
