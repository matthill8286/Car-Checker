import type { Check, ManualReport } from '@/api/client';
import { formatDate } from './format';
import { Panel, type SourceRun } from './Panel';

type Insights = NonNullable<NonNullable<Check['record']>['insights']>;
type Insight = Insights['items'][number];

/** Shape and word for each severity, so it never relies on colour alone. */
const MARK: { [K in Insight['severity']]: { icon: string; label: string } } = {
  critical: { icon: '✕', label: 'Serious' },
  warning: { icon: '!', label: 'Check' },
  info: { icon: 'i', label: 'Note' },
  good: { icon: '✓', label: 'Good' },
};

export function InsightList({
  items,
  areas,
  hide,
}: {
  items: readonly Insight[];
  areas: ReadonlyArray<Insight['area']>;
  /** Rules shown elsewhere in the panel, such as the yearly average in the mileage headline. */
  hide?: readonly string[];
}) {
  const shown = items.filter((i) => areas.includes(i.area) && !hide?.includes(i.rule));
  if (shown.length === 0) return null;
  return (
    <ul className="insights">
      {shown.map((i, n) => (
        <li key={`${i.rule}-${n}`} className={`insight insight-${i.severity}`}>
          <span className="insight-mark" aria-hidden="true">
            {MARK[i.severity].icon}
          </span>
          <span className="visually-hidden">{MARK[i.severity].label}: </span>
          <span>
            <strong>{i.title}</strong>
            {i.detail && <span className="insight-detail"> {i.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

const RATING: { [K in Insights['verdict']['rating']]: { label: string; tone: string } } = {
  avoid: { label: 'Serious concerns', tone: 'critical' },
  caution: { label: 'Some things to check', tone: 'warning' },
  good: { label: 'Looks clean', tone: 'good' },
  unknown: { label: 'Not enough data', tone: 'info' },
};

/** The overall call with the reasons behind it, first thing on the report. */
export function VerdictPanel({
  insights,
  reports,
  runs,
}: {
  insights: Insights | undefined;
  reports: readonly ManualReport[];
  runs: readonly SourceRun[];
}) {
  const latest = reports[0];
  const v = insights?.verdict;
  const r = v ? RATING[v.rating] : null;
  return (
    <Panel
      title="Verdict"
      runs={runs}
      sources={['dvla', 'dvsa_mot', 'rdw', 'nhtsa_vpic', 'manual']}
      hasData={Boolean(v)}
      empty="No source had enough to judge this vehicle."
    >
      {v && r && (
        <div className={`verdict verdict-${r.tone}`}>
          <p className="verdict-rating">
            <span className="insight-mark" aria-hidden="true">
              {MARK[r.tone as Insight['severity']].icon}
            </span>
            {r.label}
          </p>
          <p className="verdict-headline">{v.headline}</p>
          {v.reasons.length > 0 && <InsightList items={v.reasons} areas={AREAS} />}
          <p className="muted verdict-note">
            {latest
              ? `Free official records plus ${reports.length === 1 ? 'a bought report' : `${reports.length} bought reports`} (latest ${latest.provider}, ${formatDate(latest.purchasedOn)}).`
              : 'Based on free official records only. Finance, theft and write-off history need a paid check: record one under Bought reports.'}
          </p>
        </div>
      )}
    </Panel>
  );
}

const AREAS: ReadonlyArray<Insight['area']> = [
  'provenance',
  'mileage',
  'mot',
  'defects',
  'sources',
  'status',
];
