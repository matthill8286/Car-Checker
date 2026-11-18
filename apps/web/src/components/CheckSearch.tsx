'use client';

import { detectIdentifier, type QueryHint } from '@carcheck/core';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { listChecks, startCheck, type CheckSummary } from '@/api/client';
import { RecentChecks } from './RecentChecks';

const HINTS: Array<{ value: QueryHint; label: string }> = [
  { value: 'auto', label: 'Detect' },
  { value: 'GB', label: 'UK reg' },
  { value: 'NL', label: 'Dutch plate' },
  { value: 'VIN', label: 'VIN' },
];

export function hintFor(kind: 'uk_reg' | 'nl_plate' | 'vin'): QueryHint {
  return kind === 'uk_reg' ? 'GB' : kind === 'nl_plate' ? 'NL' : 'VIN';
}

const KIND_LABEL = { uk_reg: 'UK registration', nl_plate: 'Dutch plate', vin: 'VIN' } as const;

/** The search form. On the home page it also lists recent checks; on a report it is compact. */
export function CheckSearch({ compact = false }: { compact?: boolean }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [hint, setHint] = useState<QueryHint>('auto');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [recent, setRecent] = useState<CheckSummary[]>([]);

  useEffect(() => {
    if (!compact) void listChecks().then(setRecent);
  }, [compact]);

  // Instant feedback from the shared validation; the API validates again on submit.
  const detected = useMemo(
    () => (query.trim() ? detectIdentifier(query, hint) : null),
    [query, hint],
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setSubmitting(true);
    setError(null);
    const result = await startCheck(query, hint);
    if (!result.ok) {
      setSubmitting(false);
      setError([result.error.message, ...(result.error.details ?? [])].join(' '));
      return;
    }
    router.push(`/check/${result.created.check.id}`);
    setSubmitting(false);
    setQuery('');
  }

  return (
    <section className={compact ? 'search search-compact' : 'search'}>
      <form onSubmit={(e) => void onSubmit(e)} className="search-form" aria-label="Vehicle search">
        <label htmlFor="query" className="visually-hidden">
          Registration, plate or VIN
        </label>
        <input
          id="query"
          className="plate-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="AB12 CDE"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={40}
        />
        <select
          aria-label="What you entered"
          value={hint}
          onChange={(e) => setHint(e.target.value as QueryHint)}
        >
          {HINTS.map((h) => (
            <option key={h.value} value={h.value}>
              {h.label}
            </option>
          ))}
        </select>
        <button type="submit" disabled={submitting || !detected?.ok}>
          {submitting ? 'Starting…' : 'Check'}
        </button>
      </form>
      <p className="search-hint" aria-live="polite">
        {detected === null
          ? 'Try AB12 CDE, WX65 ABC, ZK-472-T or 1HGCM82633A004352.'
          : detected.ok
            ? `${KIND_LABEL[detected.identifier.kind]}: ${detected.identifier.display}${
                detected.ambiguous ? ' (could also be a Dutch plate)' : ''
              }`
            : detected.message}
      </p>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!compact && <RecentChecks checks={recent} />}
    </section>
  );
}
