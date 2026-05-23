import React, { useState } from 'react';
import {
  Box,
  Paper,
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Typography,
  TextField,
  Stack,
  Divider,
  CircularProgress,
} from '@mui/material';
import { getObjectColor } from '../lib/objectColors';

interface ObjectListItem {
  id: string;
  title: string;
  date?: string;
  preview?: string;
  tags?: string[];
}

interface ObjectListProps {
  items: ObjectListItem[];
  type: string;
  onSelect: (id: string) => void;
  selectedId?: string;
  loading?: boolean;
}

export default function ObjectList({
  items,
  type,
  onSelect,
  selectedId,
  loading = false,
}: ObjectListProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const token = getObjectColor(type);

  const filtered = items.filter(item =>
    item.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.date?.includes(searchQuery) ||
    item.preview?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <Paper sx={{ p: 2, bgcolor: '#1a1c1f', border: '1px solid rgba(255,255,255,0.09)', height: '100%' }}>
      <Stack spacing={2} sx={{ height: '100%', display: 'flex' }}>
        <TextField
          size="small"
          placeholder="Search..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          variant="outlined"
        />

        <List sx={{ flex: 1, overflow: 'auto', p: 0 }}>
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
              <CircularProgress size={20} />
            </Box>
          ) : filtered.length === 0 ? (
            <Typography variant="body2" sx={{ color: '#b8bec8', textAlign: 'center', py: 3 }}>
              No {type} found
            </Typography>
          ) : (
            filtered.map((item, idx) => (
            <Box key={item.id}>
              <ListItem disablePadding>
                <ListItemButton
                  selected={selectedId === item.id}
                  onClick={() => onSelect(item.id)}
                  sx={{
                    py: 1.5,
                    '&.Mui-selected': {
                      bgcolor: token.bg,
                    },
                  }}
                >
                  <ListItemText
                    primary={
                      <Typography variant="body2" sx={{ fontWeight: 500 }}>
                        {item.title}
                      </Typography>
                    }
                    secondary={
                      <Stack spacing={0.5}>
                        {item.date && (
                          <Typography variant="caption" sx={{ color: token.text }}>
                            {item.date}
                          </Typography>
                        )}
                        {item.preview && (
                          <Typography variant="caption" sx={{ color: token.text, display: '-webkit-box', overflow: 'hidden', textOverflow: 'ellipsis', WebkitLineClamp: 1 }}>
                            {item.preview}
                          </Typography>
                        )}
                        {item.tags && item.tags.length > 0 && (
                          <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5 }}>
                            {item.tags.slice(0, 2).map((tag) => (
                              <Typography
                                key={tag}
                                variant="caption"
                                sx={{
                                  bgcolor: token.bg,
                                  px: 0.75,
                                  py: 0.25,
                                  borderRadius: '2px',
                                  fontSize: '10px',
                                  color: token.text,
                                }}
                              >
                                #{tag}
                              </Typography>
                            ))}
                            {item.tags.length > 2 && (
                              <Typography variant="caption" sx={{ color: token.text }}>
                                +{item.tags.length - 2}
                              </Typography>
                            )}
                          </Box>
                        )}
                      </Stack>
                    }
                  />
                </ListItemButton>
              </ListItem>
              {idx < filtered.length - 1 && <Divider sx={{ borderColor: 'rgba(255,255,255,0.09)' }} />}
            </Box>
          ))
          )}
        </List>
      </Stack>
    </Paper>
  );
}

