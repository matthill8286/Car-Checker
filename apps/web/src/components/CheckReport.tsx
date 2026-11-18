'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { startCheck } from '@/api/client';
import { CheckResult } from './CheckResult';
import { CheckSearch, hintFor } from './CheckSearch';
import { useCheck } from './useCheck';

/** The report permalink: `/check/<id>`, loaded through the API and live while it runs. */
export function CheckReport({ id }: { id: string }) {
  const router = useRouter();
  const loaded = useCheck(id);
  const [error, setError] = useState<string | null>(null);

  async function rerun(query: string, kind: 'uk_reg' | 'nl_plate' | 'vin', fresh: boolean) {
    setError(null);
    const result = await startCheck(query, hintFor(kind), fresh);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    router.push(`/check/${result.created.check.id}`);
  }

  return (
    <>
      <CheckSearch compact />
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {loaded.state === 'loading' && (
        <p className="muted" aria-live="polite">
          Loading the report…
        </p>
      )}
      {loaded.state === 'missing' && (
        <p className="error" role="alert">
          There is no report at this address. It may have been made before reports were saved.
        </p>
      )}
      {loaded.state === 'ready' && (
        <>
          {loaded.streamLost && (
            <p className="error" role="alert">
              Lost the connection to the API while the check was running. Reload to see the latest.
            </p>
          )}
          <CheckResult
            check={loaded.check}
            onSearchAs={(kind) => void rerun(loaded.check.query, kind, false)}
            onRefresh={() => void rerun(loaded.check.query, loaded.check.identifier.kind, true)}
            onRecheck={() => void rerun(loaded.check.query, loaded.check.identifier.kind, false)}
          />
        </>
      )}
    </>
  );
}
