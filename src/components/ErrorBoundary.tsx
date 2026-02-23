import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
    children?: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
        errorInfo: null
    };

    public static getDerivedStateFromError(error: Error): State {
        // Update state so the next render will show the fallback UI.
        return { hasError: true, error, errorInfo: null };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error("Uncaught error:", error, errorInfo);
        this.setState({ errorInfo });
    }

    public render() {
        if (this.state.hasError) {
            return (
                <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
                    <div className="bg-white rounded-xl border border-rose-200 shadow-sm p-6 max-w-lg w-full">
                        <h2 className="text-xl font-bold text-rose-600 mb-2">무언가 잘못되었습니다 (오류 발생)</h2>
                        <p className="text-sm text-slate-600 mb-4">
                            화면을 렌더링하는 도중 오류가 발생했습니다. 아래 오류 메시지를 개발자에게 전달해 주세요.
                        </p>
                        <div className="bg-slate-900 border border-slate-700 rounded-lg p-3 overflow-auto max-h-64 mb-4">
                            <pre className="text-xs text-rose-400 font-mono whitespace-pre-wrap">
                                {this.state.error && this.state.error.toString()}
                            </pre>
                            <pre className="text-[10px] text-slate-400 font-mono mt-2 whitespace-pre-wrap">
                                {this.state.errorInfo && this.state.errorInfo.componentStack}
                            </pre>
                        </div>
                        <button
                            onClick={() => window.location.reload()}
                            className="w-full py-2 bg-slate-800 text-white rounded hover:bg-slate-700 transition"
                        >
                            새로고침
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
