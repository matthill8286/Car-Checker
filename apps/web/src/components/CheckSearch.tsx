'use client';

import { detectIdentifier, type QueryHint } from '@carcheck/core';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { followCheck, startCheck, type Check } from '@/api/client';
import { applyEvent } from './checkState';
import { CheckResult } from './CheckResult';

const HINTS: Array<{ value: QueryHint; label: string }> = [
  { value: 'auto', label: 'Detect' },
  { value: 'GB', label: 'UK reg' },
  { value: 'NL', label: 'Dutch plate' },
  { value: 'VIN', label: 'VIN' },
];

const KIND_LABEL = { uk_reg: 'UK registration', nl_plate: 'Dutch plate', vin: 'VIN' } as const;

export function CheckSearch() {
  const [query, setQuery] = useState('');
  const [hint, setHint] = useState<QueryHint>('auto');
  const [check, setCheck] = useState<Check | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const stop = useRef<(() => void) | null>(null);

  useEffect(() => () => stop.current?.(), []);

  // Instant feedback from the shared validation; the API validates again on submit.
  const detected = useMemo(
    () => (query.trim() ? detectIdentifier(query, hint) : null),
    [query, hint],
  );

  async function run(q: string, h: QueryHint) {
    stop.current?.();
    setSubmitting(true);
    setError(null);
    const result = await startCheck(q, h);
    setSubmitting(false);
    if (!result.ok) {
      setCheck(null);
      setError([result.error.message, ...(result.error.details ?? [])].join(' '));
      return;
    }
    setCheck(result.created.check);
    stop.current = followCheck(
      result.created.check.id,
      (event) => setCheck((current) => applyEvent(current, event)),
      () => setError('Lost the connection to the API while the check was running.'),
    );
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    void run(query, hint);
  }

  function searchAs(kind: 'uk_reg' | 'nl_plate' | 'vin') {
    const h: QueryHint = kind === 'uk_reg' ? 'GB' : kind === 'nl_plate' ? 'NL' : 'VIN';
    setHint(h);
    void run(check?.query ?? query, h);
  }

  return (
    <section className="search">
      <form onSubmit={onSubmit} className="search-form" aria-label="Vehicle search">
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
      {check && <CheckResult check={check} onSearchAs={searchAs} />}
    </section>
  );
}
