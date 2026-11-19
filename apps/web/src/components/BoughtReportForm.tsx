'use client';

import { ManualReportInputSchema } from '@carcheck/core';
import { useState, type FormEvent } from 'react';
import { saveManualReport, type ManualReport, type ManualReportBody } from '@/api/client';

type Status = 'clear' | 'recorded' | 'not_checked';
type Category = 'A' | 'B' | 'C' | 'D' | 'S' | 'N';

const PROVIDERS = [
  'HPI Check',
  'Total Car Check',
  'The AA Car Check',
  'RAC Car Check',
  'Experian AutoCheck',
  'UK Vehicle Data',
  'carVertical',
  'autoDNA',
];

const STATUS_LABEL: Record<Status, string> = {
  not_checked: 'Not in report',
  clear: 'Clear',
  recorded: 'Recorded',
};

const CATEGORIES: Array<{ id: Category; label: string }> = [
  { id: 'S', label: 'S: structural, repaired' },
  { id: 'N', label: 'N: non-structural, repaired' },
  { id: 'A', label: 'A: scrap only' },
  { id: 'B', label: 'B: break for parts' },
  { id: 'C', label: 'C (pre-2017)' },
  { id: 'D', label: 'D (pre-2017)' },
];

interface FormState {
  registration: string;
  vin: string;
  provider: string;
  purchasedOn: string;
  cost: string;
  reference: string;
  finance: Status;
  financeDetail: string;
  stolen: Status;
  stolenDetail: string;
  writeOff: Status;
  category: Category | '';
  writeOffDate: string;
  scrapped: Status;
  imported: Status;
  exported: Status;
  previousKeepers: string;
  keeperChanges: string[];
  plateChanges: Array<{ from: string; to: string; date: string }>;
  notes: string;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function fromReport(r: ManualReport): FormState {
  return {
    registration: r.registration ?? '',
    vin: r.vin ?? '',
    provider: r.provider,
    purchasedOn: r.purchasedOn,
    cost: (r.costPence / 100).toFixed(2),
    reference: r.reference ?? '',
    finance: r.finance.status,
    financeDetail: r.finance.detail ?? '',
    stolen: r.stolen.status,
    stolenDetail: r.stolen.detail ?? '',
    writeOff: r.writeOff.status,
    category: r.writeOff.category ?? '',
    writeOffDate: r.writeOff.date ?? '',
    scrapped: r.scrapped,
    imported: r.imported,
    exported: r.exported,
    previousKeepers: r.previousKeepers === null ? '' : String(r.previousKeepers),
    keeperChanges: r.keeperChanges,
    plateChanges: r.plateChanges.map((p) => ({ ...p, date: p.date ?? '' })),
    notes: r.notes ?? '',
  };
}

function blank(registration: string, vin: string): FormState {
  return {
    registration,
    vin,
    provider: '',
    purchasedOn: today(),
    cost: '',
    reference: '',
    finance: 'not_checked',
    financeDetail: '',
    stolen: 'not_checked',
    stolenDetail: '',
    writeOff: 'not_checked',
    category: '',
    writeOffDate: '',
    scrapped: 'not_checked',
    imported: 'not_checked',
    exported: 'not_checked',
    previousKeepers: '',
    keeperChanges: [],
    plateChanges: [],
    notes: '',
  };
}

const orNull = (v: string) => (v.trim() ? v.trim() : null);

function toBody(f: FormState): ManualReportBody {
  const recorded = f.writeOff === 'recorded';
  return {
    registration: orNull(f.registration),
    vin: orNull(f.vin),
    provider: f.provider.trim(),
    purchasedOn: f.purchasedOn,
    costPence: Math.round(Number(f.cost || '0') * 100),
    reference: orNull(f.reference),
    finance: {
      status: f.finance,
      detail: f.finance === 'recorded' ? orNull(f.financeDetail) : null,
    },
    stolen: { status: f.stolen, detail: f.stolen === 'recorded' ? orNull(f.stolenDetail) : null },
    writeOff: {
      status: f.writeOff,
      category: recorded && f.category ? f.category : null,
      date: recorded ? orNull(f.writeOffDate) : null,
    },
    scrapped: f.scrapped,
    imported: f.imported,
    exported: f.exported,
    previousKeepers: f.previousKeepers === '' ? null : Number(f.previousKeepers),
    keeperChanges: f.keeperChanges.filter(Boolean),
    plateChanges: f.plateChanges
      .filter((p) => p.from.trim() || p.to.trim())
      .map((p) => ({ from: p.from, to: p.to, date: orNull(p.date) })),
    notes: orNull(f.notes),
  };
}

function StatusSelect({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: Status;
  onChange: (s: Status) => void;
}) {
  return (
    <label htmlFor={id}>
      {label}
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as Status)}>
        {(Object.keys(STATUS_LABEL) as Status[]).map((s) => (
          <option key={s} value={s}>
            {STATUS_LABEL[s]}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * Records what a bought report found. Every risk starts as "not in report", so nothing is
 * marked clear unless the report actually said so.
 */
export function BoughtReportForm({
  report,
  registration,
  vin,
  onSaved,
  onCancel,
}: {
  report?: ManualReport;
  registration: string;
  vin: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [f, setF] = useState<FormState>(() =>
    report ? fromReport(report) : blank(registration, vin),
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setF((cur) => ({ ...cur, [key]: value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const body = toBody(f);
    // Same rules as the API, checked here so mistakes show next to the form.
    const parsed = ManualReportInputSchema.safeParse(body);
    if (!parsed.success) {
      setErrors(parsed.error.issues.map((i) => `${i.path.join('.') || 'report'}: ${i.message}`));
      return;
    }
    setSaving(true);
    const result = await saveManualReport(body, report?.id);
    setSaving(false);
    if (!result.ok) {
      setErrors([result.error.message, ...(result.error.details ?? [])]);
      return;
    }
    onSaved();
  }

  const p = report?.id ?? 'new';
  return (
    <form className="bought-form" onSubmit={(e) => void onSubmit(e)}>
      <h4>{report ? 'Edit bought report' : 'Record a bought report'}</h4>

      <fieldset>
        <legend>The report</legend>
        <label htmlFor={`${p}-provider`}>
          Provider
          <input
            id={`${p}-provider`}
            list="bought-providers"
            required
            value={f.provider}
            onChange={(e) => set('provider', e.target.value)}
          />
        </label>
        <datalist id="bought-providers">
          {PROVIDERS.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
        <label htmlFor={`${p}-date`}>
          Bought on
          <input
            id={`${p}-date`}
            type="date"
            required
            value={f.purchasedOn}
            onChange={(e) => set('purchasedOn', e.target.value)}
          />
        </label>
        <label htmlFor={`${p}-cost`}>
          Cost (£)
          <input
            id={`${p}-cost`}
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={f.cost}
            onChange={(e) => set('cost', e.target.value)}
          />
        </label>
        <label htmlFor={`${p}-ref`}>
          Reference
          <input
            id={`${p}-ref`}
            value={f.reference}
            onChange={(e) => set('reference', e.target.value)}
          />
        </label>
        <label htmlFor={`${p}-reg`}>
          Registration
          <input
            id={`${p}-reg`}
            value={f.registration}
            autoCapitalize="characters"
            onChange={(e) => set('registration', e.target.value)}
          />
        </label>
        <label htmlFor={`${p}-vin`}>
          VIN
          <input
            id={`${p}-vin`}
            value={f.vin}
            maxLength={17}
            autoCapitalize="characters"
            onChange={(e) => set('vin', e.target.value)}
          />
        </label>
      </fieldset>

      <fieldset>
        <legend>What it found</legend>
        <StatusSelect
          id={`${p}-finance`}
          label="Outstanding finance"
          value={f.finance}
          onChange={(s) => set('finance', s)}
        />
        {f.finance === 'recorded' && (
          <label htmlFor={`${p}-finance-detail`} className="wide">
            Finance details
            <input
              id={`${p}-finance-detail`}
              placeholder="Lender, agreement type, date"
              value={f.financeDetail}
              onChange={(e) => set('financeDetail', e.target.value)}
            />
          </label>
        )}
        <StatusSelect
          id={`${p}-stolen`}
          label="Stolen"
          value={f.stolen}
          onChange={(s) => set('stolen', s)}
        />
        {f.stolen === 'recorded' && (
          <label htmlFor={`${p}-stolen-detail`} className="wide">
            Theft details
            <input
              id={`${p}-stolen-detail`}
              placeholder="Police force, date reported"
              value={f.stolenDetail}
              onChange={(e) => set('stolenDetail', e.target.value)}
            />
          </label>
        )}
        <StatusSelect
          id={`${p}-writeoff`}
          label="Write-off"
          value={f.writeOff}
          onChange={(s) => set('writeOff', s)}
        />
        {f.writeOff === 'recorded' && (
          <>
            <label htmlFor={`${p}-category`}>
              Category
              <select
                id={`${p}-category`}
                value={f.category}
                onChange={(e) => set('category', e.target.value as Category | '')}
              >
                <option value="">Not given</option>
                {CATEGORIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label htmlFor={`${p}-writeoff-date`}>
              Date of loss
              <input
                id={`${p}-writeoff-date`}
                type="date"
                value={f.writeOffDate}
                onChange={(e) => set('writeOffDate', e.target.value)}
              />
            </label>
          </>
        )}
        <StatusSelect
          id={`${p}-scrapped`}
          label="Scrapped"
          value={f.scrapped}
          onChange={(s) => set('scrapped', s)}
        />
        <StatusSelect
          id={`${p}-imported`}
          label="Imported"
          value={f.imported}
          onChange={(s) => set('imported', s)}
        />
        <StatusSelect
          id={`${p}-exported`}
          label="Exported"
          value={f.exported}
          onChange={(s) => set('exported', s)}
        />
      </fieldset>

      <fieldset>
        <legend>Keepers and plates</legend>
        <label htmlFor={`${p}-keepers`}>
          Previous keepers
          <input
            id={`${p}-keepers`}
            type="number"
            min="0"
            max="99"
            value={f.previousKeepers}
            onChange={(e) => set('previousKeepers', e.target.value)}
          />
        </label>
        <div className="wide repeat">
          <span className="repeat-label">Keeper change dates</span>
          {f.keeperChanges.map((d, i) => (
            <div key={i} className="repeat-row">
              <input
                type="date"
                aria-label={`Keeper change ${i + 1}`}
                value={d}
                onChange={(e) =>
                  set(
                    'keeperChanges',
                    f.keeperChanges.map((x, j) => (j === i ? e.target.value : x)),
                  )
                }
              />
              <button
                type="button"
                className="link"
                onClick={() =>
                  set(
                    'keeperChanges',
                    f.keeperChanges.filter((_, j) => j !== i),
                  )
                }
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="link"
            onClick={() => set('keeperChanges', [...f.keeperChanges, ''])}
          >
            + Add a keeper change
          </button>
        </div>
        <div className="wide repeat">
          <span className="repeat-label">Plate changes</span>
          {f.plateChanges.map((pc, i) => {
            const update = (patch: Partial<typeof pc>) =>
              set(
                'plateChanges',
                f.plateChanges.map((x, j) => (j === i ? { ...x, ...patch } : x)),
              );
            return (
              <div key={i} className="repeat-row">
                <input
                  aria-label={`Old plate ${i + 1}`}
                  placeholder="Old plate"
                  value={pc.from}
                  onChange={(e) => update({ from: e.target.value })}
                />
                <span aria-hidden="true">→</span>
                <input
                  aria-label={`New plate ${i + 1}`}
                  placeholder="New plate"
                  value={pc.to}
                  onChange={(e) => update({ to: e.target.value })}
                />
                <input
                  type="date"
                  aria-label={`Plate change date ${i + 1}`}
                  value={pc.date}
                  onChange={(e) => update({ date: e.target.value })}
                />
                <button
                  type="button"
                  className="link"
                  onClick={() =>
                    set(
                      'plateChanges',
                      f.plateChanges.filter((_, j) => j !== i),
                    )
                  }
                >
                  Remove
                </button>
              </div>
            );
          })}
          <button
            type="button"
            className="link"
            onClick={() =>
              set('plateChanges', [...f.plateChanges, { from: '', to: f.registration, date: '' }])
            }
          >
            + Add a plate change
          </button>
        </div>
        <label htmlFor={`${p}-notes`} className="wide">
          Notes
          <textarea
            id={`${p}-notes`}
            rows={3}
            value={f.notes}
            onChange={(e) => set('notes', e.target.value)}
          />
        </label>
      </fieldset>

      {errors.length > 0 && (
        <ul className="error" role="alert">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      <div className="form-actions">
        <button type="submit" disabled={saving}>
          {saving ? 'Saving…' : 'Save and update the check'}
        </button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
