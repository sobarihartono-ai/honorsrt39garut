import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let readable = error.message || 'Terjadi kesalahan saat memproses data.';
    try {
      const parsed = JSON.parse(error.message);
      if (parsed && typeof parsed === 'object' && parsed.error) {
        readable = `Gagal menyinkronkan data (${parsed.operationType || 'operasi'}): ${parsed.error}`;
      }
    } catch {
      // Bukan error JSON Firestore
    }
    return { hasError: true, errorMessage: readable };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('App ErrorBoundary caught:', error, info);
  }

  handleReload = (): void => {
    this.setState({ hasError: false, errorMessage: '' });
    window.location.reload();
  };

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200 shadow-lg p-6 text-center">
            <div className="w-12 h-12 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <h2 className="text-lg font-bold text-slate-900 mb-2">Terjadi Gangguan Sistem</h2>
            <p className="text-sm text-slate-600 mb-5 break-words">{this.state.errorMessage}</p>
            <button
              type="button"
              onClick={this.handleReload}
              className="w-full min-h-[44px] bg-slate-900 hover:bg-slate-800 text-white font-semibold text-sm rounded-xl px-4 py-2.5 flex items-center justify-center gap-2 transition"
            >
              <RotateCcw className="w-4 h-4" />
              Muat Ulang Aplikasi
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
