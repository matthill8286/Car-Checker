import type { SourceId } from '@carcheck/core';

export const SOURCE_NAMES: Record<SourceId, string> = {
  dvla: 'DVLA',
  dvsa_mot: 'DVSA',
  rdw: 'RDW',
  nhtsa_vpic: 'NHTSA',
};

const dateFmt = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});
const monthFmt = new Intl.DateTimeFormat('en-GB', { month: 'short', year: 'numeric' });

/** Formats full ISO dates and month-only ones (`2012-04`). */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  if (/^\d{4}-\d{2}$/.test(value)) return monthFmt.format(new Date(`${value}-01T00:00:00Z`));
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : dateFmt.format(d);
}

const dateTimeFmt = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? value : dateTimeFmt.format(d);
}

export function formatNumber(value: number | null | undefined, unit?: string): string {
  if (value === null || value === undefined) return '—';
  return `${value.toLocaleString('en-GB')}${unit ? ` ${unit}` : ''}`;
}
