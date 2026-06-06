import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * 予期せぬ実行時エラーで「真っ白な画面」になるのを防ぐ。
 * エラー内容を画面に表示して、原因を追えるようにする。
 */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error('アプリでエラーが発生しました', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, fontFamily: 'system-ui, sans-serif', color: '#1d3557' }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>
            😢 エラーが発生しました
          </h1>
          <p style={{ fontSize: 14, marginBottom: 12 }}>
            画面を再読み込みしても直らない場合は、この内容を共有してください。
          </p>
          <pre
            style={{
              background: '#f1f5f9',
              padding: 12,
              borderRadius: 8,
              fontSize: 12,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
          <button
            onClick={() => { localStorage.removeItem('sushiking-data'); location.reload(); }}
            style={{
              marginTop: 12,
              padding: '10px 16px',
              background: '#E63946',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontWeight: 600,
            }}
          >
            データをリセットして再読み込み
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
