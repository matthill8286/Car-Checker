import Link from 'next/link';
import type { CheckSummary } from '@/api/client';
import { formatDate } from './format';

export function RecentChecks({ checks }: { checks: CheckSummary[] }) {
  // One row per vehicle: the list is newest first, so keep the first check of each.
  const seen = new Set<string>();
  const unique = checks.filter((c) => {
    const key = `${c.identifier.kind}:${c.identifier.value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (unique.length === 0) return null;
  return (
    <section className="recent" aria-label="Recent checks">
      <h3>Recent checks</h3>
      <ul>
        {unique.map((c) => (
          <li key={c.id}>
            <Link className="recent-item" href={`/check/${c.id}`}>
              <span className="recent-plate">{c.identifier.display}</span>
              <span>{c.title ?? 'No record found'}</span>
              <span className="muted">{formatDate(c.createdAt)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
