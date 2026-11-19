'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import {
  getVehicle,
  listGarage,
  saveVehicle,
  unsaveVehicle,
  type VehicleSummary,
} from '@/api/client';
import { formatDateTime } from './format';

const money = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
  maximumFractionDigits: 0,
});

export function formatPrice(pence: number | null | undefined): string {
  return pence === null || pence === undefined ? '—' : money.format(pence / 100);
}

/**
 * Garage controls on a report: save the vehicle with notes, asking price and listing link,
 * and jump to a comparison with another saved vehicle.
 */
export function GaragePanel({ vehicleId, checkId }: { vehicleId: string; checkId: string }) {
  const router = useRouter();
  const [vehicle, setVehicle] = useState<VehicleSummary | null>(null);
  const [others, setOthers] = useState<VehicleSummary[]>([]);
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState('');
  const [price, setPrice] = useState('');
  const [link, setLink] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getVehicle(vehicleId).then(setVehicle);
    void listGarage().then((list) => setOthers(list.filter((v) => v.id !== vehicleId)));
  }, [vehicleId]);

  function startEdit() {
    const s = vehicle?.saved;
    setNotes(s?.notes ?? '');
    setPrice(s?.askingPricePence != null ? String(s.askingPricePence / 100) : '');
    setLink(s?.listingUrl ?? '');
    setError(null);
    setEditing(true);
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const result = await saveVehicle(vehicleId, {
      notes: notes.trim() || null,
      askingPricePence: price.trim() ? Math.round(Number(price) * 100) : null,
      listingUrl: link.trim() || null,
    });
    setBusy(false);
    if (!result.ok) {
      setError([result.error.message, ...(result.error.details ?? [])].join(' '));
      return;
    }
    setVehicle(result.vehicle);
    setEditing(false);
  }

  async function onRemove() {
    setBusy(true);
    if (await unsaveVehicle(vehicleId)) setVehicle((v) => (v ? { ...v, saved: null } : v));
    setBusy(false);
  }

  if (!vehicle) return null;
  const saved = vehicle.saved;
  const isLatest = vehicle.latestCheckId === checkId;

  return (
    <section className="panel garage-panel">
      <div className="panel-head">
        <h3>{saved ? 'In your garage' : 'Garage'}</h3>
        {saved && <span className="source-badge">saved {formatDateTime(saved.updatedAt)}</span>}
      </div>
      {!isLatest && (
        <p className="panel-note warning">
          This is an older check.{' '}
          <Link href={`/check/${vehicle.latestCheckId}`}>Open the latest one</Link>.
        </p>
      )}
      {saved && !editing && (
        <dl className="facts garage-facts">
          <div className="fact">
            <dt>Asking price</dt>
            <dd>{formatPrice(saved.askingPricePence)}</dd>
          </div>
          <div className="fact">
            <dt>Listing</dt>
            <dd>
              {saved.listingUrl ? (
                <a href={saved.listingUrl} target="_blank" rel="noopener noreferrer">
                  {new URL(saved.listingUrl).hostname}
                </a>
              ) : (
                '—'
              )}
            </dd>
          </div>
          {saved.notes && (
            <div className="fact garage-notes">
              <dt>Notes</dt>
              <dd>{saved.notes}</dd>
            </div>
          )}
        </dl>
      )}
      {editing ? (
        <form className="garage-form" onSubmit={(e) => void onSave(e)}>
          <label>
            Asking price (£)
            <input
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
            />
          </label>
          <label>
            Listing link
            <input
              type="url"
              placeholder="https://"
              value={link}
              onChange={(e) => setLink(e.target.value)}
            />
          </label>
          <label className="wide">
            Notes
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          {error && (
            <p className="error wide" role="alert">
              {error}
            </p>
          )}
          <div className="form-actions wide">
            <button type="submit" disabled={busy}>
              {saved ? 'Save changes' : 'Save to garage'}
            </button>
            <button type="button" className="secondary" onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="form-actions">
          <button type="button" className="secondary" onClick={startEdit}>
            {saved ? 'Edit notes and price' : 'Save to garage'}
          </button>
          {saved && (
            <button
              type="button"
              className="link danger"
              disabled={busy}
              onClick={() => void onRemove()}
            >
              Remove from garage
            </button>
          )}
          {others.length > 0 && (
            <label className="compare-pick">
              <span className="visually-hidden">Compare with</span>
              <select
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) router.push(`/compare?a=${checkId}&b=${e.target.value}`);
                }}
              >
                <option value="">Compare with…</option>
                {others.map((o) => (
                  <option key={o.id} value={o.latestCheckId}>
                    {o.identifier.display} {o.title ?? ''}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}
    </section>
  );
}
