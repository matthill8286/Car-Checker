import type { SourceId } from '@carcheck/core';
import type { ReactNode } from 'react';
import type { Check } from '@/api/client';
import { formatDateTime, SOURCE_NAMES } from './format';

export type SourceRun = Check['sources'][number];

/** One source's part in a panel: who supplied it, and when they were last asked. */
export function SourceBadge({ run }: { run: SourceRun }) {
  const name = SOURCE_NAMES[run.source];
  let text: string;
  switch (run.status) {
    case 'pending':
    case 'running':
      text = `${name} · checking…`;
      break;
    case 'error':
      text = `${name} · failed`;
      break;
    case 'not_found':
      text = `${name} · no record`;
      break;
    case 'skipped':
      text = `${name} · skipped`;
      break;
    case 'ok':
      text = `${name} · ${run.cached ? 'saved' : 'fetched'} ${formatDateTime(run.fetchedAt)}`;
      break;
  }
  return (
    <span
      className={`source-badge badge-${run.status}`}
      title={run.mock ? 'From recorded fixtures, not the live source' : undefined}
    >
      {text}
      {run.mock && ' · fixture'}
    </span>
  );
}

function names(runs: readonly SourceRun[]): string {
  return runs.map((r) => SOURCE_NAMES[r.source]).join(' and ');
}

/**
 * A report panel that knows which sources feed it, so it can show its own loading, partial,
 * error and empty states instead of waiting for the whole check.
 */
export function Panel({
  title,
  runs,
  sources,
  hasData,
  empty,
  intro,
  children,
}: {
  title: ReactNode;
  runs: readonly SourceRun[];
  /** The sources whose answers this panel shows. */
  sources: readonly SourceId[];
  hasData: boolean;
  /** Shown when every source answered and none had anything for this panel. */
  empty: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  const own = runs.filter((r) => sources.includes(r.source) && r.status !== 'skipped');
  if (own.length === 0 && !hasData) return null;

  const waiting = own.filter((r) => r.status === 'pending' || r.status === 'running');
  const failed = own.filter((r) => r.status === 'error');

  let body: ReactNode;
  if (hasData) {
    body = (
      <>
        {intro}
        {failed.length > 0 && (
          <p className="panel-note warning">{names(failed)} failed, so this may be incomplete.</p>
        )}
        {waiting.length > 0 && (
          <p className="panel-note muted">Still waiting for {names(waiting)}…</p>
        )}
        {children}
      </>
    );
  } else if (waiting.length > 0) {
    body = (
      <div className="panel-loading" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
    );
  } else if (failed.length > 0) {
    body = (
      <p className="panel-note error">
        {failed.map((r) => r.message ?? `${SOURCE_NAMES[r.source]} failed.`).join(' ')}
      </p>
    );
  } else {
    body = <p className="muted">{empty}</p>;
  }

  return (
    <section className="panel" aria-busy={!hasData && waiting.length > 0}>
      <div className="panel-head">
        <h3>{title}</h3>
        <div className="panel-sources">
          {own.map((r) => (
            <SourceBadge key={r.source} run={r} />
          ))}
        </div>
      </div>
      {body}
    </section>
  );
}
