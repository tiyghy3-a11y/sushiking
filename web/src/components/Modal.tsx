import type { ReactNode } from 'react';
import { useEffect } from 'react';

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

export function Modal({ title, onClose, children, footer }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 'var(--space-md)' }}>
          <h2 className="t-tagline">{title}</h2>
          <button type="button" className="link t-caption" onClick={onClose}>
            閉じる
          </button>
        </div>
        {children}
        {footer && (
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 'var(--space-lg)' }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
