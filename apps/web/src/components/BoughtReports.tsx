'use client';

import { latestFlags, PROVENANCE_RISKS, type LatestFlag } from '@carcheck/core';
import { useState } from 'react';
import { deleteManualReport, type Check, type ManualReport } from '@/api/client';
import { BoughtReportForm } from './BoughtReportForm';
import { formatDate } from './format';
import { InsightList } from './Insights';
import { KeeperTimeline } from './KeeperTimeline';
import { Panel } from './Panel';

const LABEL = new Map(PROVENANCE_RISKS.map((r) => [r.risk, r.label]));

function tone(flag: LatestFlag): string {
  if (flag.status === 'not_checked') return 'neutral';
  if (flag.status === 'clear') return 'good';
  return flag.risk === 'imported' ||
    (flag.risk === 'writeOff' && flag.category && 'SNCD'.includes(flag.category))
    ? 'warn'
    : 'bad';
}

function value(flag: LatestFlag): string {
  if (flag.status === 'not_checked') return 'Not checked';
  if (flag.status === 'clear') return 'None';
  if (flag.risk === 'writeOff') return flag.category ? `Category ${flag.category}` : 'Recorded';
  return 'Recorded';
}

function FlagCards({ reports }: { reports: ManualReport[] }) {
  // Imported, exported and scrapped only get a card when a report covered them.
  const flags = latestFlags(reports).filter(
    (f) => ['finance', 'stolen', 'writeOff'].includes(f.risk) || f.status !== 'not_checked',
  );
  return (
    <div className="cards">
      {flags.map((f) => (
        <div key={f.risk} className={`card tone-${tone(f)}`}>
          <div className="card-title">{LABEL.get(f.risk)}</div>
          <div className="card-value">{value(f)}</div>
          {f.detail && <div className="card-detail">{f.detail}</div>}
          {f.report && (
            <div className="card-detail">
              {f.report.provider}, {formatDate(f.report.purchasedOn)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const money = new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' });

/**
 * Paid-for findings (M6): flag cards, the ownership timeline, the reports themselves, and the
 * form to record a new one. Saving starts a new check so the verdict takes it into account.
 */
export function BoughtReports({ check, onChanged }: { check: Check; onChanged: () => void }) {
  const [editing, setEditing] = useState<ManualReport | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const run = check.sources.find((s) => s.source === 'manual');
  if (!run) return null;

  const record = check.record;
  const reports = record?.manualReports ?? [];
  const done = run.status === 'ok' || run.status === 'not_found';
  const registration =
    check.identifier.kind === 'vin' ? (record?.facts.registration ?? '') : check.identifier.value;
  const vin = check.identifier.kind === 'vin' ? check.identifier.value : (record?.facts.vin ?? '');
  const spent = reports.reduce((sum, r) => sum + r.costPence, 0);

  async function remove(r: ManualReport) {
    setBusy(true);
    const ok = await deleteManualReport(r.id);
    setBusy(false);
    if (ok) onChanged();
  }

  return (
    <Panel
      title={reports.length > 0 ? `Bought reports (${reports.length})` : 'Bought reports'}
      runs={check.sources}
      sources={['manual']}
      hasData={done || reports.length > 0}
      empty=""
      intro={
        <p className="muted panel-intro">
          Finance, theft and write-off records are only in paid checks. Type in what a bought report
          found and it joins the free data and the verdict.
        </p>
      }
    >
      {reports.length > 0 && (
        <>
          <FlagCards reports={reports} />
          {record?.insights && (
            <InsightList
              items={record.insights.items}
              areas={['provenance']}
              hide={[
                'provenance.finance',
                'provenance.stolen',
                'provenance.write_off',
                'provenance.scrapped',
                'provenance.exported',
                'provenance.imported',
              ]}
            />
          )}
          <KeeperTimeline
            reports={reports}
            firstRegistration={record?.facts.firstRegistrationDate}
          />
          <ul className="bought-list">
            {reports.map((r) => (
              <li key={r.id}>
                <span>
                  <strong>{r.provider}</strong> · {formatDate(r.purchasedOn)} ·{' '}
                  {money.format(r.costPence / 100)}
                  {r.reference && <span className="muted"> · ref {r.reference}</span>}
                  {r.notes && <span className="bought-notes">{r.notes}</span>}
                </span>
                <span className="bought-actions">
                  <button type="button" className="link" onClick={() => setEditing(r)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="link danger"
                    disabled={busy}
                    onClick={() => void remove(r)}
                  >
                    Delete
                  </button>
                </span>
              </li>
            ))}
          </ul>
          {reports.length > 1 && (
            <p className="muted bought-total">
              Spent on reports for this car: {money.format(spent / 100)}
            </p>
          )}
        </>
      )}
      {reports.length === 0 && done && (
        <p className="muted">No bought reports for this vehicle yet.</p>
      )}
      {editing ? (
        <BoughtReportForm
          key={editing === 'new' ? 'new' : editing.id}
          report={editing === 'new' ? undefined : editing}
          registration={registration}
          vin={vin}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
          onCancel={() => setEditing(null)}
        />
      ) : (
        <button type="button" className="secondary" onClick={() => setEditing('new')}>
          Record a bought report
        </button>
      )}
    </Panel>
  );
}
