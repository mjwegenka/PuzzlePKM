import React from 'react'
import { Alert } from '@/components/ui/alert'

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
      <div className="p-2">
        <Alert variant="destructive" className="mb-3">
          Failed to render this object.
        </Alert>
        <p className="text-xs text-[var(--color-text-secondary)]">
          {this.state.message}
        </p>
      </div>
    )
  }
}

