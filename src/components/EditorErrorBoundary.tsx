import React from 'react'
import { Alert, Box, Typography } from '@mui/material'

interface EditorErrorBoundaryProps {
  children: React.ReactNode
}

interface EditorErrorBoundaryState {
  hasError: boolean
  message: string
}

export default class EditorErrorBoundary extends React.Component<EditorErrorBoundaryProps, EditorErrorBoundaryState> {
  state: EditorErrorBoundaryState = {
    hasError: false,
    message: '',
  }

  static getDerivedStateFromError(error: unknown): EditorErrorBoundaryState {
    return {
      hasError: true,
      message: String(error),
    }
  }

  componentDidCatch(error: unknown): void {
    // Keep error visible in developer console for root-cause follow-up.
    console.error('Editor render failure:', error)
  }

  render(): React.ReactNode {
    if (!this.state.hasError) return this.props.children

    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="error" sx={{ mb: 1.5 }}>
          Failed to render this object.
        </Alert>
        <Typography variant="caption" sx={{ color: '#b8bec8' }}>
          {this.state.message}
        </Typography>
      </Box>
    )
  }
}

