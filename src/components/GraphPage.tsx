import React from 'react'
import { Box, Typography } from '@mui/material'
import HubIcon from '@mui/icons-material/Hub'

export default function GraphPage() {
  return (
    <Box
      sx={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        color: '#4a6a8a',
      }}
    >
      <HubIcon sx={{ fontSize: 56, opacity: 0.35 }} />
      <Typography variant="h6" sx={{ fontWeight: 600, color: '#7dbad6' }}>
        Graph
      </Typography>
      <Typography variant="body2" sx={{ textAlign: 'center', maxWidth: 380 }}>
        A visual graph of your connected objects and links will appear here.
        <br />
        This surface is coming in a future release.
      </Typography>
    </Box>
  )
}
