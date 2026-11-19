'use client';

import { latestFlags, PROVENANCE_RISKS } from '@carcheck/core';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { getCheck, getVehicle, type Check, type VehicleSummary } from '@/api/client';
import { formatDate, formatNumber } from './format';
import { formatPrice } from './GaragePanel';
import { keeperEvents } from './keeperEvents';
import { VerdictBadge } from './Verdict';

interface Side {
  check: Check;
  vehicle: VehicleSummary | null;
}

type Row = { label: string; value: (s: Side) => ReactNode };
type Section = { title: string; rows: Row[] };

const LABEL = new Map(PROVENANCE_RISKS.map((r) => [r.risk, r.label]));

function facts(s: Side) {
  return s.check.record?.facts ?? {};
}

function title(s: Side): string {
  const f = facts(s);
  return [f.make, f.model].filter(Boolean).join(' ') || s.check.identifier.display;
}

function count(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

const SECTIONS: Section[] = [
  {
    title: 'Verdict',
    rows: [
      {
        label: 'Rating',
        value: (s) => (
          <VerdictBadge rating={s.check.record?.insights?.verdict.rating ?? 'unknown'} />
        ),
      },
      {
        label: 'Main concerns',
        value: (s) => {
          const reasons = s.check.record?.insights?.verdict.reasons ?? [];
          if (reasons.length === 0) return 'None';
          return (
            <ul className="compare-reasons">
              {reasons.slice(0, 3).map((r, i) => (
                <li key={i} className={`insight-${r.severity}`}>
                  <span className="insight-mark" aria-hidden="true">
                    {r.severity === 'critical' ? '✕' : '!'}
                  </span>
                  {r.title}
                </li>
              ))}
              {reasons.length > 3 && <li className="muted">and {reasons.length - 3} more</li>}
            </ul>
          );
        },
      },
      { label: 'Asking price', value: (s) => formatPrice(s.vehicle?.saved?.askingPricePence) },
    ],
  },
  {
    title: 'Vehicle',
    rows: [
      { label: 'First registered', value: (s) => formatDate(facts(s).firstRegistrationDate) },
      { label: 'Fuel', value: (s) => facts(s).fuelType ?? '—' },
      { label: 'Engine', value: (s) => formatNumber(facts(s).engineCapacityCc, 'cc') },
      { label: 'Colour', value: (s) => facts(s).colour ?? '—' },
      { label: 'Tax', value: (s) => facts(s).taxStatus ?? '—' },
    ],
  },
  {
    title: 'Mileage',
    rows: [
      {
        label: 'Latest reading',
        value: (s) => {
          const l = s.check.record?.mileage.latest;
          return l
            ? `${formatNumber(l.odometer.value, l.odometer.unit)} (${formatDate(l.date)})`
            : '—';
        },
      },
      {
        label: 'Per year',
        value: (s) => {
          const m = s.check.record?.mileage;
          return m?.averagePerYear ? formatNumber(m.averagePerYear, m.unit ?? undefined) : '—';
        },
      },
      {
        label: 'For its age',
        value: (s) => {
          const e = s.check.record?.insights?.mileage.expected;
          return e ? { low: 'Low', typical: 'Typical', high: 'High' }[e.position] : '—';
        },
      },
      {
        label: 'Anomalies',
        value: (s) => {
          const n = s.check.record?.mileage.anomalies.length ?? 0;
          return n === 0 ? 'None' : count(n, 'anomaly', 'anomalies');
        },
      },
    ],
  },
  {
    title: 'MOT',
    rows: [
      {
        label: 'Valid until',
        value: (s) => {
          const f = facts(s);
          return f.motExpiryDate ? formatDate(f.motExpiryDate) : (f.motStatus ?? '—');
        },
      },
      {
        label: 'Tests',
        value: (s) => {
          const tests = s.check.record?.motTests ?? [];
          if (tests.length === 0) return '—';
          const fails = tests.filter((t) => t.result === 'failed').length;
          return `${tests.length}, ${count(fails, 'fail')}`;
        },
      },
      {
        label: 'Defects',
        value: (s) => {
          const defects = (s.check.record?.motTests ?? []).flatMap((t) => t.defects);
          const dangerous = defects.filter((d) => d.dangerous).length;
          return dangerous > 0
            ? `${defects.length}, ${dangerous} dangerous`
            : defects.length
              ? String(defects.length)
              : '—';
        },
      },
      {
        label: 'Repeat advisories',
        value: (s) => {
          const n = s.check.record?.insights?.mot.repeatAdvisories.length;
          return n === undefined ? '—' : n === 0 ? 'None' : String(n);
        },
      },
      {
        label: 'Lapses',
        value: (s) => {
          const n = s.check.record?.insights?.mot.lapses.length;
          return n === undefined ? '—' : n === 0 ? 'None' : String(n);
        },
      },
    ],
  },
  {
    title: 'Bought reports',
    rows: [
      ...(['finance', 'stolen', 'writeOff'] as const).map((risk): Row => ({
        label: LABEL.get(risk) ?? risk,
        value: (s) => {
          const reports = s.check.record?.manualReports ?? [];
          const flag = latestFlags(reports).find((f) => f.risk === risk);
          if (!flag || flag.status === 'not_checked')
            return <span className="muted">Not checked</span>;
          if (flag.status === 'clear') return 'None';
          return (
            <span className="compare-flag insight-critical">
              <span className="insight-mark" aria-hidden="true">
                ✕
              </span>
              {risk === 'writeOff' && flag.category ? `Category ${flag.category}` : 'Recorded'}
            </span>
          );
        },
      })),
      {
        label: 'Keepers',
        value: (s) => {
          const reports = s.check.record?.manualReports ?? [];
          if (reports.length === 0) return <span className="muted">Not checked</span>;
          const { periods } = keeperEvents(reports, facts(s).firstRegistrationDate);
          return periods.length ? String(periods.length) : '—';
        },
      },
    ],
  },
];

/** Two checks side by side, section by section, each column linking back to its report. */
export function Compare({ a, b }: { a: string; b: string }) {
  const [sides, setSides] = useState<Side[] | null | 'missing'>(null);

  useEffect(() => {
    const load = async (id: string): Promise<Side | null> => {
      const check = await getCheck(id);
      if (!check) return null;
      const vehicle = check.vehicleId ? await getVehicle(check.vehicleId) : null;
      return { check, vehicle };
    };
    void Promise.all([load(a), load(b)]).then((r) =>
      setSides(r[0] && r[1] ? [r[0], r[1]] : 'missing'),
    );
  }, [a, b]);

  if (sides === null) return <p className="muted">Loading both reports…</p>;
  if (sides === 'missing') {
    return (
      <p className="muted">
        One of these reports no longer exists. Go back to your <Link href="/garage">garage</Link>.
      </p>
    );
  }

  return (
    <div className="compare-wrap">
      <table className="compare">
        <thead>
          <tr>
            <th scope="col">
              <span className="visually-hidden">Field</span>
            </th>
            {sides.map((s) => (
              <th key={s.check.id} scope="col">
                <span className="plate" data-country={s.check.identifier.country ?? 'VIN'}>
                  {s.check.identifier.display}
                </span>
                <Link href={`/check/${s.check.id}`} className="compare-title">
                  {title(s)}
                </Link>
                <span className="muted compare-checked">
                  Checked {formatDate(s.check.createdAt)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        {SECTIONS.map((section) => (
          <tbody key={section.title}>
            <tr className="compare-section">
              <th colSpan={3} scope="colgroup">
                {section.title}
              </th>
            </tr>
            {section.rows.map((row) => (
              <tr key={row.label}>
                <th scope="row">{row.label}</th>
                {sides.map((s) => (
                  <td key={s.check.id}>{row.value(s)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        ))}
      </table>
      {sides.some((s) => s.vehicle?.saved?.notes) && (
        <div className="compare-notes">
          {sides.map((s) => (
            <div key={s.check.id} className="panel">
              <h3>{title(s)}</h3>
              <p>{s.vehicle?.saved?.notes ?? <span className="muted">No notes.</span>}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
