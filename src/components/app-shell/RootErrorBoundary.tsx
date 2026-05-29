import React, { ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error?: Error
  errorInfo?: React.ErrorInfo
}

export class RootErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('App crashed:', error, errorInfo)
    this.setState(prev => ({
      ...prev,
      errorInfo
    }))
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen w-screen flex-col items-center justify-center bg-slate-900 p-6">
          <div className="max-w-md rounded-lg border border-red-500 bg-slate-800 p-6">
            <h1 className="text-lg font-bold text-red-400">Application Error</h1>
            <p className="mt-3 text-sm text-red-300">{this.state.error?.message || 'An unknown error occurred'}</p>

            {this.state.errorInfo && (
              <details className="mt-4">
                <summary className="cursor-pointer text-xs text-gray-400 hover:text-gray-300">Stack trace</summary>
                <pre className="mt-2 overflow-auto rounded bg-slate-900 p-2 text-xs text-gray-400">
                  {this.state.errorInfo.componentStack}
                </pre>
              </details>
            )}

            <button
              onClick={() => window.location.reload()}
              className="mt-4 w-full rounded bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-700"
            >
              Reload App
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

