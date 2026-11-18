import type { SourceId } from '@carcheck/core';
import type { Check } from '@/api/client';
import { formatDate, formatDateTime, formatNumber, SOURCE_NAMES } from './format';

type Record = NonNullable<Check['record']>;
type Facts = Record['facts'];

const STATUS_TEXT: { [K in Check['sources'][number]['status']]: string } = {
  pending: 'Waiting',
  running: 'Checking…',
  ok: 'Found',
  not_found: 'No record',
  error: 'Failed',
  skipped: 'Skipped',
};

const CHECK_STATUS: { [K in Check['status']]: string } = {
  running: 'Checking sources…',
  complete: 'Check complete',
  partial: 'Check finished, but some sources failed',
  failed: 'Check failed',
};

const FACT_ROWS: Array<{ key: keyof Facts; label: string; format?: (v: never) => string }> = [
  { key: 'make', label: 'Make' },
  { key: 'model', label: 'Model' },
  { key: 'variant', label: 'Variant' },
  { key: 'bodyType', label: 'Body' },
  { key: 'colour', label: 'Colour' },
  { key: 'fuelType', label: 'Fuel' },
  { key: 'engineCapacityCc', label: 'Engine', format: (v: number) => formatNumber(v, 'cc') },
  { key: 'cylinders', label: 'Cylinders' },
  { key: 'co2EmissionsGKm', label: 'CO₂', format: (v: number) => formatNumber(v, 'g/km') },
  { key: 'euroStatus', label: 'Euro status' },
  { key: 'massEmptyKg', label: 'Empty mass', format: (v: number) => formatNumber(v, 'kg') },
  { key: 'seats', label: 'Seats' },
  { key: 'yearOfManufacture', label: 'Year of manufacture' },
  { key: 'modelYear', label: 'Model year' },
  { key: 'firstRegistrationDate', label: 'First registered', format: formatDate },
  { key: 'lastKeeperChangeDate', label: 'Last keeper change', format: formatDate },
  { key: 'plantCountry', label: 'Built in' },
  { key: 'listPriceEur', label: 'List price new', format: (v: number) => `€${formatNumber(v)}` },
  { key: 'vin', label: 'VIN' },
];

function SourceTag({ source }: { source: SourceId | undefined }) {
  if (!source) return null;
  return <span className="source-tag">{SOURCE_NAMES[source]}</span>;
}

function display(value: unknown, format?: (v: never) => string): string {
  if (value === undefined || value === null) return '—';
  if (format) return format(value as never);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}

function StatusCards({ record }: { record: Record }) {
  const f = record.facts;
  const isNl = f.country === 'NL';
  const recall = f.outstandingRecall;
  const cards = [
    !isNl && {
      title: 'Tax',
      value: f.taxStatus ?? '—',
      detail: f.taxDueDate ? `Due ${formatDate(f.taxDueDate)}` : null,
      tone: f.taxStatus === 'Taxed' ? 'good' : f.taxStatus ? 'warn' : 'neutral',
    },
    {
      title: isNl ? 'APK (MOT)' : 'MOT',
      value: f.motStatus ?? '—',
      detail: f.motExpiryDate ? `Expires ${formatDate(f.motExpiryDate)}` : null,
      tone: f.motStatus === 'Valid' ? 'good' : f.motStatus ? 'warn' : 'neutral',
    },
    {
      title: 'Outstanding recall',
      value: recall === 'yes' ? 'Yes' : recall === 'no' ? 'None' : 'Unknown',
      detail: null,
      tone: recall === 'yes' ? 'bad' : recall === 'no' ? 'good' : 'neutral',
    },
    f.markedForExport !== undefined && {
      title: 'Marked for export',
      value: f.markedForExport ? 'Yes' : 'No',
      detail: null,
      tone: f.markedForExport ? 'bad' : 'good',
    },
    f.insured !== undefined && {
      title: 'Insured (WAM)',
      value: f.insured ? 'Yes' : 'No',
      detail: null,
      tone: f.insured ? 'good' : 'warn',
    },
  ].filter(Boolean) as Array<{ title: string; value: string; detail: string | null; tone: string }>;

  return (
    <div className="cards">
      {cards.map((c) => (
        <div key={c.title} className={`card tone-${c.tone}`}>
          <div className="card-title">{c.title}</div>
          <div className="card-value">{c.value}</div>
          {c.detail && <div className="card-detail">{c.detail}</div>}
        </div>
      ))}
    </div>
  );
}

function MileagePanel({ record }: { record: Record }) {
  const m = record.mileage;
  if (!m.latest) return null;
  return (
    <section className="panel">
      <h3>Mileage</h3>
      <p>
        Last recorded {formatNumber(m.latest.odometer.value, m.latest.odometer.unit)} on{' '}
        {formatDate(m.latest.date)}
        {m.averagePerYear !== null && (
          <> · about {formatNumber(m.averagePerYear, m.unit ?? '')} a year</>
        )}
      </p>
      {m.anomalies.map((a) => (
        <p key={`${a.from.date}-${a.to.date}`} className="warning">
          ⚠ {a.message}
        </p>
      ))}
    </section>
  );
}

function MotHistory({ record }: { record: Record }) {
  if (record.motTests.length === 0) return null;
  return (
    <section className="panel">
      <h3>MOT history ({record.motTests.length})</h3>
      <ol className="mot-list">
        {record.motTests.map((t) => (
          <li key={t.testNumber ?? t.completedAt} className={`mot mot-${t.result}`}>
            <div className="mot-head">
              <span className="mot-result">{t.result === 'passed' ? 'Pass' : 'Fail'}</span>
              <span>{formatDate(t.completedAt)}</span>
              <span>
                {t.odometer ? formatNumber(t.odometer.value, t.odometer.unit) : 'Odometer not read'}
              </span>
              {t.expiryDate && <span className="muted">Expires {formatDate(t.expiryDate)}</span>}
            </div>
            {t.defects.length > 0 && (
              <ul className="defects">
                {t.defects.map((d, i) => (
                  <li
                    key={i}
                    className={`defect defect-${d.type}${d.dangerous ? ' defect-dangerous' : ''}`}
                  >
                    <span className="defect-type">
                      {d.dangerous ? 'dangerous' : d.type.replace('_', ' ')}
                    </span>{' '}
                    {d.text}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

export function CheckResult({
  check,
  onSearchAs,
  onRefresh,
}: {
  check: Check;
  onSearchAs: (kind: 'uk_reg' | 'nl_plate' | 'vin') => void;
  onRefresh: () => void;
}) {
  const anyCached = check.sources.some((s) => s.cached);
  const record = check.record;
  const provenance = (record?.provenance ?? {}) as { [field: string]: SourceId };
  const facts = record?.facts;
  const title = facts ? [facts.make, facts.model].filter(Boolean).join(' ') : null;

  return (
    <article className="result" aria-busy={check.status === 'running'}>
      <header className="result-head">
        <div className="plate" data-country={check.identifier.country ?? 'VIN'}>
          {check.identifier.display}
        </div>
        <div>
          <h2>{title || 'No vehicle details yet'}</h2>
          <p className="muted">{CHECK_STATUS[check.status]}</p>
        </div>
        {anyCached && check.status !== 'running' && (
          <button type="button" className="refresh" onClick={onRefresh}>
            Check again
          </button>
        )}
      </header>

      {check.alternatives.length > 0 && (
        <p className="alternatives">
          This could also be{' '}
          {check.alternatives.map((alt) => (
            <button
              key={alt.kind}
              type="button"
              className="link"
              onClick={() => onSearchAs(alt.kind)}
            >
              {alt.kind === 'nl_plate'
                ? `Dutch plate ${alt.display}`
                : `UK registration ${alt.display}`}
            </button>
          ))}
          .
        </p>
      )}

      <ul className="sources">
        {check.sources.map((s) => (
          <li key={s.source} className={`source source-${s.status}`}>
            <span className="source-name">{s.label}</span>
            <span className="source-status">{STATUS_TEXT[s.status]}</span>
            {s.mock && <span className="source-tag">fixture</span>}
            {s.cached && (
              <span className="source-tag" title="Reused from an earlier check">
                saved {formatDateTime(s.fetchedAt)}
              </span>
            )}
            {s.message && <span className="source-message">{s.message}</span>}
          </li>
        ))}
      </ul>

      {record && facts && (
        <>
          <StatusCards record={record} />
          <section className="panel">
            <h3>Vehicle</h3>
            <dl className="facts">
              {FACT_ROWS.filter((r) => facts[r.key] !== undefined).map((r) => (
                <div key={r.key} className="fact">
                  <dt>{r.label}</dt>
                  <dd>
                    {display(facts[r.key], r.format)} <SourceTag source={provenance[r.key]} />
                  </dd>
                </div>
              ))}
            </dl>
            {record.conflicts.length > 0 && (
              <div className="conflicts">
                <h4>Sources disagree</h4>
                <ul>
                  {record.conflicts.map((c) => (
                    <li key={c.field}>
                      {c.field}:{' '}
                      {c.values
                        .map((v) => `${SOURCE_NAMES[v.source]} says ${String(v.value)}`)
                        .join(', ')}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
          <MileagePanel record={record} />
          <MotHistory record={record} />
        </>
      )}
      {!record && check.status !== 'running' && (
        <p className="muted">No source had a record for this vehicle.</p>
      )}
    </article>
  );
}
