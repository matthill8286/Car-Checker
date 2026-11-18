import type { CheckSummary } from '@/api/client';
import { formatDate } from './format';

export function RecentChecks({
  checks,
  currentId,
  onOpen,
}: {
  checks: CheckSummary[];
  currentId: string | null;
  onOpen: (id: string) => void;
}) {
  if (checks.length === 0) return null;
  return (
    <section className="recent" aria-label="Recent checks">
      <h3>Recent checks</h3>
      <ul>
        {checks.map((c) => (
          <li key={c.id}>
            <button
              type="button"
              className="recent-item"
              aria-current={c.id === currentId ? 'true' : undefined}
              onClick={() => onOpen(c.id)}
            >
              <span className="recent-plate">{c.identifier.display}</span>
              <span>{c.title ?? 'No record found'}</span>
              <span className="muted">{formatDate(c.createdAt)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
