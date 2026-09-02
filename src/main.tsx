import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: any;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("Critical Runtime Error caught by ErrorBoundary:", error, errorInfo);
  }

  handleReset = () => {
    localStorage.removeItem('midnight_voting_proposals');
    localStorage.removeItem('midnight_freighter_proposals');
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          color: '#ffffff',
          textAlign: 'center',
          fontFamily: 'system-ui, sans-serif'
        }}>
          <div style={{
            background: 'rgba(25, 25, 45, 0.95)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '16px',
            padding: '2.5rem',
            maxWidth: '560px',
            boxShadow: '0 20px 50px rgba(0, 0, 0, 0.6)'
          }}>
            <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>⚠️</div>
            <h2 style={{ fontSize: '1.4rem', marginBottom: '0.75rem' }}>Voting App State Reset Needed</h2>
            <p style={{ color: '#a0a0ba', fontSize: '0.9rem', marginBottom: '1.5rem', lineHeight: '1.5' }}>
              A previous local session state was detected that is being updated to the Level 4 schema.
            </p>
            <div style={{
              background: 'rgba(0,0,0,0.4)',
              padding: '0.75rem',
              borderRadius: '8px',
              fontFamily: 'monospace',
              fontSize: '0.8rem',
              color: '#ff7b75',
              marginBottom: '1.5rem',
              wordBreak: 'break-all',
              textAlign: 'left'
            }}>
              {this.state.error?.message || String(this.state.error)}
            </div>
            <button
              onClick={this.handleReset}
              style={{
                background: 'linear-gradient(135deg, #8a2be2, #00f0ff)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '8px',
                padding: '0.85rem 1.8rem',
                fontSize: '1rem',
                fontWeight: 'bold',
                cursor: 'pointer'
              }}
            >
              🔄 Reset Sandbox & Reload App
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
