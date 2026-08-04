// Top-level error boundary. Without this, any uncaught render error
// unmounts the whole React tree and leaves a blank white page with no
// clue what happened.
import { Component, type ErrorInfo, type ReactNode } from 'react'

interface ErrorBoundaryState {
  error: Error | null
  info: ErrorInfo | null
}

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, info: null }

  static getDerivedStateFromError(error: Error) {
    return { error, info: null }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ error, info })
    console.error('Designer crashed:', error, info)
  }

  render() {
    const { error, info } = this.state
    if (error) {
      return (
        <div className="mx-auto max-w-2xl p-6 font-mono text-sm">
          <h1 className="mb-2 text-base font-bold text-red-700">
            Something went wrong
          </h1>
          <p className="mb-3 text-slate-600">
            The Designer hit an unexpected error. Copy the details below.
          </p>
          <pre className="overflow-auto rounded border border-red-200 bg-red-50 p-3 text-xs text-red-800">
            {error.message}
            {'\n\n'}
            {error.stack}
            {info?.componentStack}
          </pre>
          <button
            type="button"
            onClick={() => this.setState({ error: null, info: null })}
            className="mt-3 rounded bg-slate-700 px-3 py-1.5 text-xs text-white hover:bg-slate-800"
          >
            Try again
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
