import React from 'react'
import { Chip, Stack, Typography } from '@mui/material'
import { alpha } from '@mui/material/styles'
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown'
import CloseIcon from '@mui/icons-material/Close'

interface FilterChipProps {
  icon?: React.ReactElement
  label: string
  selected?: boolean
  showCaret?: boolean
  onToggle?: () => void
  onDismiss?: () => void
}

export default function FilterChip({
  icon,
  label,
  selected = false,
  showCaret = false,
  onToggle,
  onDismiss,
}: FilterChipProps) {
  return (
    <Chip
      size="small"
      icon={icon}
      clickable={Boolean(onToggle)}
      onClick={onToggle}
      onDelete={onDismiss}
      deleteIcon={onDismiss ? <CloseIcon sx={{ fontSize: 14, color: '#8f9bab !important' }} /> : undefined}
      label={(
        <Stack direction="row" spacing={0.2} alignItems="center">
          <Typography component="span" sx={{ fontSize: '11px', fontWeight: 500 }}>
            {label}
          </Typography>
          {showCaret && !onDismiss && <KeyboardArrowDownIcon sx={{ fontSize: 14, color: '#8f9bab' }} />}
        </Stack>
      )}
      sx={{
        height: 24,
        borderRadius: '999px',
        color: selected ? '#dbe7f5' : '#b4c1cf',
        bgcolor: selected ? alpha('#60a5fa', 0.18) : alpha('#ffffff', 0.03),
        border: `1px solid ${selected ? alpha('#60a5fa', 0.44) : alpha('#d8e1eb', 0.16)}`,
        '& .MuiChip-icon': { fontSize: 13, color: selected ? '#9ec9ff' : '#8f9bab', ml: 0.6 },
        '& .MuiChip-label': { px: 0.75 },
        '&:hover': {
          bgcolor: selected ? alpha('#60a5fa', 0.24) : alpha('#ffffff', 0.06),
          borderColor: selected ? alpha('#8ec3ff', 0.58) : alpha('#d8e1eb', 0.24),
        },
      }}
    />
  )
}
