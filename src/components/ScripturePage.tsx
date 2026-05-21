import React from 'react'
import { Box, Typography } from '@mui/material'
import AutoStoriesIcon from '@mui/icons-material/AutoStories'

export default function ScripturePage() {
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
      <AutoStoriesIcon sx={{ fontSize: 56, opacity: 0.35 }} />
      <Typography variant="h6" sx={{ fontWeight: 600, color: '#7dbad6' }}>
        Scripture
      </Typography>
      <Typography variant="body2" sx={{ textAlign: 'center', maxWidth: 380 }}>
        Ordered scripture objects and passage references will appear here.
        <br />
        This surface is coming in a future release.
      </Typography>
    </Box>
  )
}
