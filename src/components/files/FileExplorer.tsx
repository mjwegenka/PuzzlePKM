import React, { useState, useEffect, useCallback } from 'react';
import {
  Box,
  Paper,
  Stack,
  Typography,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Divider,
  CircularProgress,
  Alert,
  IconButton,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import FolderIcon from '@mui/icons-material/Folder';
import ArticleIcon from '@mui/icons-material/Article';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import RefreshIcon from '@mui/icons-material/Refresh';
import AddIcon from '@mui/icons-material/Add';
import { listFileMeta } from '../../lib/cliService';

interface FileItem {
  id: string;
  name: string;
  author?: string;
  syncPath: string;
  type: 'project' | 'ref-material';
}

interface FileExplorerProps {
  onSelect: (id: string, type: 'project' | 'ref-material') => void;
  selectedId?: string;
  onCreateNew?: (type: 'project' | 'ref-material') => void;
  /** Increment this to trigger a list reload (e.g. after a rename/save). */
  refreshKey?: number;
}

export default function FileExplorer({ onSelect, selectedId, onCreateNew, refreshKey }: FileExplorerProps) {
  const [items, setItems] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [sortBy, setSortBy] = useState<'name' | 'author'>('name');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const raw = await listFileMeta();
      setItems(raw);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const filterText = filter.toLowerCase();
  const matchesFilter = (i: FileItem) =>
    i.name.toLowerCase().includes(filterText) ||
    (i.author ?? '').toLowerCase().includes(filterText);
  const compareItems = (a: FileItem, b: FileItem) => {
    if (sortBy === 'author') {
      const byAuthor = (a.author ?? '').localeCompare(b.author ?? '', undefined, { sensitivity: 'base' });
      if (byAuthor !== 0) return byAuthor;
    }
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  };
  const projects = items
    .filter((i) => i.type === 'project' && matchesFilter(i))
    .sort(compareItems);
  const refMaterials = items
    .filter((i) => i.type === 'ref-material' && matchesFilter(i))
    .sort(compareItems);

  return (
    <Paper sx={{ p: 2, bgcolor: 'surface.elevated', border: '1px solid', borderColor: 'border.subtle', height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1.5 }}>
        <Typography variant="h6" sx={{ fontWeight: 600, fontSize: '15px' }}>
          Files
        </Typography>
        <IconButton size="small" onClick={load} title="Refresh" sx={{ color: 'text.secondary' }}>
          <RefreshIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Stack>

      {/* Filter + sort */}
      <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
        <TextField
          size="small"
          placeholder="Filter by name/author…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          variant="outlined"
          sx={{ flex: 1 }}
        />
        <FormControl size="small" sx={{ minWidth: 120 }}>
          <InputLabel id="file-sort-label">Sort</InputLabel>
          <Select
            labelId="file-sort-label"
            label="Sort"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as 'name' | 'author')}
          >
            <MenuItem value="name">Name</MenuItem>
            <MenuItem value="author">Author</MenuItem>
          </Select>
        </FormControl>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 1, fontSize: '12px' }}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <CircularProgress size={24} />
        </Box>
      ) : (
        <Box sx={{ flex: 1, overflow: 'auto' }}>
          {/* Projects section */}
          <SectionHeader
            label="Projects"
            icon={<FolderIcon sx={{ fontSize: 14, mr: 0.5, color: 'warning.main' }} />}
            onAdd={onCreateNew ? () => onCreateNew('project') : undefined}
          />
          <List sx={{ p: 0, mb: 0.5 }}>
            {projects.length === 0 ? (
              <EmptyNote text="No projects" />
            ) : (
              projects.map((item, idx) => (
                <FileListItem
                  key={item.id}
                  item={item}
                  selected={selectedId === item.id}
                  showDivider={idx < projects.length - 1}
                  onSelect={onSelect}
                  icon={<FolderIcon sx={{ fontSize: 16, color: 'warning.main', mr: 1, flexShrink: 0 }} />}
                />
              ))
            )}
          </List>

          <Divider sx={{ borderColor: 'border.subtle', my: 1 }} />

          {/* Reference Materials section */}
          <SectionHeader
            label="Reference Materials"
            icon={<MenuBookIcon sx={{ fontSize: 14, mr: 0.5, color: 'accent.metadata' }} />}
            onAdd={onCreateNew ? () => onCreateNew('ref-material') : undefined}
          />
          <List sx={{ p: 0 }}>
            {refMaterials.length === 0 ? (
              <EmptyNote text="No reference materials" />
            ) : (
              refMaterials.map((item, idx) => (
                <FileListItem
                  key={item.id}
                  item={item}
                  selected={selectedId === item.id}
                  showDivider={idx < refMaterials.length - 1}
                  onSelect={onSelect}
                  icon={<ArticleIcon sx={{ fontSize: 16, color: 'accent.metadata', mr: 1, flexShrink: 0 }} />}
                />
              ))
            )}
          </List>
        </Box>
      )}
    </Paper>
  );
}

function SectionHeader({
  label,
  icon,
  onAdd,
}: {
  label: string;
  icon: React.ReactNode;
  onAdd?: () => void;
}) {
  return (
    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 0.5, py: 0.5 }}>
      <Stack direction="row" alignItems="center">
        {icon}
        <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: '10px' }}>
          {label}
        </Typography>
      </Stack>
      {onAdd && (
        <IconButton size="small" onClick={onAdd} sx={{ p: 0.25, color: 'text.secondary', '&:hover': { color: 'text.primary' } }}>
          <AddIcon sx={{ fontSize: 14 }} />
        </IconButton>
      )}
    </Stack>
  );
}

function FileListItem({
  item,
  selected,
  showDivider,
  onSelect,
  icon,
}: {
  item: FileItem;
  selected: boolean;
  showDivider: boolean;
  onSelect: (id: string, type: 'project' | 'ref-material') => void;
  icon: React.ReactNode;
}) {
  return (
    <Box>
      <ListItem disablePadding>
        <ListItemButton
          selected={selected}
          onClick={() => onSelect(item.id, item.type)}
          sx={{
            py: 0.75,
            borderRadius: '4px',
            '&.Mui-selected': { bgcolor: 'action.selected' },
            '&:hover': { bgcolor: 'surface.sunken' },
          }}
        >
          {icon}
          <ListItemText
            primary={
              <Typography variant="body2" sx={{ fontWeight: 500, fontSize: '13px' }}>
                {item.name}
              </Typography>
            }
            secondary={
              <>
                {item.type === 'ref-material' && item.author && (
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '11px', display: 'block' }}>
                    by {item.author}
                  </Typography>
                )}
                {item.syncPath && item.syncPath !== '(no path)' ? (
                  <Typography variant="caption" sx={{ color: 'text.disabled', fontSize: '11px' }}>
                    {item.syncPath}
                  </Typography>
                ) : null}
              </>
            }
          />
        </ListItemButton>
      </ListItem>
      {showDivider && <Divider sx={{ borderColor: 'border.subtle' }} />}
    </Box>
  );
}

function EmptyNote({ text }: { text: string }) {
  return (
    <Typography variant="caption" sx={{ color: 'text.disabled', display: 'block', px: 1, py: 0.5, fontStyle: 'italic' }}>
      {text}
    </Typography>
  );
}
