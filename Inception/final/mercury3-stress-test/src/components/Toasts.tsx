import { CheckCircle2, AlertTriangle, Info, XCircle, X } from 'lucide-react';
import { useFF } from '../state/store';

const ICONS = {
  success: <CheckCircle2 size={16} color="var(--green)" />,
  warning: <AlertTriangle size={16} color="var(--yellow)" />,
  error: <XCircle size={16} color="var(--red)" />,
  info: <Info size={16} color="var(--accent)" />,
};

export function Toasts() {
  const toasts = useFF((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          <div className="toast-icon">{ICONS[t.kind]}</div>
          <div style={{ flex: 1 }}>
            <div className="toast-title">{t.title}</div>
            {t.message ? <div className="toast-msg">{t.message}</div> : null}
          </div>
          <button className="toast-close" onClick={() => useFF.getState().dismissToast(t.id)}>
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
