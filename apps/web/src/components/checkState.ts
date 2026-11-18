import type { CheckEvent } from '@carcheck/core';
import type { Check } from '@/api/client';

/** Folds one streamed event into the check the page is showing. */
export function applyEvent(check: Check | null, event: CheckEvent): Check | null {
  switch (event.type) {
    case 'snapshot':
    case 'complete':
      return event.check as Check;
    case 'source': {
      if (!check) return check;
      const others = check.sources.filter((s) => s.source !== event.run.source);
      const sources = check.sources.some((s) => s.source === event.run.source)
        ? check.sources.map((s) => (s.source === event.run.source ? event.run : s))
        : [...others, event.run];
      return { ...check, sources };
    }
    case 'record':
      return check ? { ...check, record: event.record as Check['record'] } : check;
  }
}
