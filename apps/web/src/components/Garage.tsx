'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { listGarage, type VehicleSummary } from '@/api/client';
import { formatDate, formatNumber } from './format';
import { formatPrice } from './GaragePanel';
import { VerdictBadge } from './Verdict';

/** Saved vehicles as cards, with a two-way pick for the compare view. */
export function Garage() {
  const router = useRouter();
  const [vehicles, setVehicles] = useState<VehicleSummary[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);

  useEffect(() => {
    void listGarage().then(setVehicles);
  }, []);

  if (vehicles === null) return <p className="muted">Loading your garage…</p>;
  if (vehicles.length === 0) {
    return (
      <p className="muted">
        Nothing saved yet. Run a <Link href="/">check</Link> and choose &ldquo;Save to garage&rdquo;
        on the report.
      </p>
    );
  }

  const toggle = (checkId: string) =>
    setPicked((cur) =>
      cur.includes(checkId) ? cur.filter((x) => x !== checkId) : [...cur, checkId].slice(-2),
    );

  return (
    <>
      <div className="garage-bar">
        <span className="muted">
          {picked.length === 2 ? 'Ready to compare.' : `Pick ${2 - picked.length} to compare.`}
        </span>
        <button
          type="button"
          disabled={picked.length !== 2}
          onClick={() => router.push(`/compare?a=${picked[0]}&b=${picked[1]}`)}
        >
          Compare
        </button>
      </div>
      <ul className="garage-list">
        {vehicles.map((v) => (
          <li key={v.id} className="panel garage-card">
            <label className="garage-pick">
              <input
                type="checkbox"
                checked={picked.includes(v.latestCheckId)}
                onChange={() => toggle(v.latestCheckId)}
              />
              <span className="visually-hidden">Compare {v.identifier.display}</span>
            </label>
            <div className="garage-main">
              <div className="garage-title">
                <span className="plate" data-country={v.identifier.country ?? 'VIN'}>
                  {v.identifier.display}
                </span>
                <Link href={`/check/${v.latestCheckId}`}>
                  <strong>{v.title ?? 'Unknown vehicle'}</strong>
                </Link>
              </div>
              <VerdictBadge rating={v.verdict} />
              {v.concerns > 0 && (
                <span className="muted">
                  {' '}
                  · {v.concerns} {v.concerns === 1 ? 'thing' : 'things'} to look at
                </span>
              )}
              <dl className="garage-stats">
                <div>
                  <dt>Asking</dt>
                  <dd>{formatPrice(v.saved?.askingPricePence)}</dd>
                </div>
                <div>
                  <dt>Mileage</dt>
                  <dd>
                    {v.latestMileage
                      ? formatNumber(v.latestMileage.odometer.value, v.latestMileage.odometer.unit)
                      : '—'}
                  </dd>
                </div>
                <div>
                  <dt>MOT</dt>
                  <dd>
                    {v.motExpiryDate ? `to ${formatDate(v.motExpiryDate)}` : (v.motStatus ?? '—')}
                  </dd>
                </div>
                <div>
                  <dt>Checked</dt>
                  <dd>{formatDate(v.checkedAt)}</dd>
                </div>
              </dl>
              {v.saved?.notes && <p className="garage-note">{v.saved.notes}</p>}
              {v.saved?.listingUrl && (
                <a href={v.saved.listingUrl} target="_blank" rel="noopener noreferrer">
                  View listing
                </a>
              )}
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
