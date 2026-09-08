import { useState, type FormEvent } from 'react';
import { Send } from 'lucide-react';
import type { Provenance } from '@webatlas/shared';
import type { AssistantTurn } from '../model/useAssistant';

interface Props {
  turns: AssistantTurn[];
  loading: boolean;
  error: string | null;
  onSend: (message: string) => void;
  onRetry: () => void;
}

function ProvenanceChips({ records }: { records: Provenance[] }) {
  if (records.length === 0) return null;
  return (
    <div className="assistant-provenance">
      {records.map((r, i) => (
        <span
          key={i}
          className="assistant-chip"
          title={`Công cụ: ${r.tool}${r.layerKey ? ` · lớp ${r.layerKey}` : ''}`}
        >
          {r.tool} · {r.rowCount} bản ghi
          {r.datasetVersion ? ` · ${r.datasetVersion}` : ''}
        </span>
      ))}
      {records
        .filter((r) => r.sql)
        .map((r, i) => (
          <pre key={`sql-${i}`} className="assistant-sql">{r.sql}</pre>
        ))}
    </div>
  );
}

/** Passive. Every piece of state lives in useAssistant except the draft. */
export function AssistantPanelView({ turns, loading, error, onSend, onRetry }: Props) {
  const [draft, setDraft] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!draft.trim()) return;
    onSend(draft.trim());
    setDraft('');
  };

  return (
    <div className="assistant-panel">
      <h2 className="panel-title">Trợ lý</h2>

      {/* polite, not assertive: a reply should be announced without cutting off
          whatever the screen reader is already saying. The error block below
          keeps its own role="alert", which is the one thing worth interrupting for. */}
      <div className="assistant-transcript" aria-live="polite" aria-busy={loading}>
        {turns.length === 0 && (
          <p className="assistant-hint">
            Hỏi về đập, sông, hồ và các lớp hiểm họa trong vùng công tác — hoặc bảo tôi di chuyển
            bản đồ. Ví dụ: “Có bao nhiêu đập trong khu vực đang xem?”
          </p>
        )}

        {turns.map((turn, i) =>
          turn.role === 'user' ? (
            <p key={i} className="assistant-turn assistant-turn-user">{turn.text}</p>
          ) : (
            <div key={i} className="assistant-turn assistant-turn-bot">
              {turn.segments.map((segment, j) =>
                segment.kind === 'knowledge' ? (
                  // Bordered callout with its own background and an explicit
                  // label — the spec rules out italics, which users skim past.
                  <aside key={j} className="assistant-knowledge">
                    <span className="assistant-knowledge-label">
                      Kiến thức chung, không phải dữ liệu hệ thống
                    </span>
                    <p>{segment.text}</p>
                  </aside>
                ) : (
                  <p key={j}>{segment.text}</p>
                )
              )}
              <ProvenanceChips records={turn.provenance} />
            </div>
          )
        )}

        {loading && <p className="assistant-status">Đang xử lý…</p>}

        {error && (
          <div className="assistant-error" role="alert">
            <span>{error}</span>
            <button type="button" onClick={onRetry}>Thử lại</button>
          </div>
        )}
      </div>

      <form className="assistant-composer" onSubmit={submit}>
        <textarea
          aria-label="Câu hỏi cho trợ lý"
          value={draft}
          disabled={loading}
          rows={2}
          placeholder="Hỏi trợ lý…"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter is a newline — the chat convention.
            //
            // isComposing is load-bearing here, not a nicety: this UI is Vietnamese,
            // and Telex/VNI input methods commit a character with Enter mid-word.
            // Without the guard, typing "hồ" can fire the message instead of the
            // diacritic. React exposes the flag on the native event.
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit(e);
            }
          }}
        />
        <button type="submit" disabled={loading || !draft.trim()} aria-label="Gửi">
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
