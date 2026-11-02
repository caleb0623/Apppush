/** Pure calculations, kept free of I/O so that they can be unit-tested by hand. */

export interface Funnel {
  planned: number;
  valid: number;
  sent: number;
  delivered: number;
  displayed: number;
  clicked: number;
}

export const emptyFunnel = (): Funnel => ({
  planned: 0,
  valid: 0,
  sent: 0,
  delivered: 0,
  displayed: 0,
  clicked: 0,
});

/** Returns null, not 0, when nothing could have happened: "no data" is not "0%". */
export const safeRate = (numerator: number, denominator: number): number | null =>
  denominator === 0 ? null : Math.round((numerator / denominator) * 10_000) / 10_000;

export const computeRates = (f: Funnel) => ({
  deliveryRate: safeRate(f.delivered, f.sent),
  displayRate: safeRate(f.displayed, f.delivered),
  clickThroughRate: safeRate(f.clicked, f.displayed),
});

/**
 * The four loss stages of planned-valid-sent-delivered-clicked. `notDisplayed` is
 * extra detail inside the last stage, so it is not added to the other four.
 */
export const computeLoss = (f: Funnel) => ({
  invalid: f.planned - f.valid,
  notSent: f.valid - f.sent,
  notDelivered: f.sent - f.delivered,
  notClicked: f.delivered - f.clicked,
  notDisplayed: f.delivered - f.displayed,
});

/** One message-device pair: the unit of counting, however many attempts it took. */
export interface TargetFact {
  msgid: string;
  bucket: string;
  platform: string | null;
  channel: string | null;
  deliveryMode: string;
  messageType: string;
  appVersion: string | null;
  isValid: boolean;
  invalidReason: string | null;
  failureReason: string | null;
  events: ReadonlySet<string>;
}

export function addFact(funnel: Funnel, fact: Pick<TargetFact, 'isValid' | 'events'>): void {
  funnel.planned += 1;
  if (fact.isValid) funnel.valid += 1;
  if (fact.events.has('SENT')) funnel.sent += 1;
  if (fact.events.has('DELIVERED')) funnel.delivered += 1;
  if (fact.events.has('DISPLAYED')) funnel.displayed += 1;
  if (fact.events.has('CLICKED')) funnel.clicked += 1;
}

export const summarize = (funnel: Funnel) => ({
  ...funnel,
  ...computeRates(funnel),
  loss: computeLoss(funnel),
});

export function groupFacts(
  facts: readonly TargetFact[],
  keyOf: (fact: TargetFact) => string | null,
) {
  const groups = new Map<string, Funnel>();
  for (const fact of facts) {
    const key = keyOf(fact);
    if (key === null) continue;
    const funnel = groups.get(key) ?? emptyFunnel();
    addFact(funnel, fact);
    groups.set(key, funnel);
  }
  return [...groups.entries()]
    .map(([key, funnel]) => ({ key, ...summarize(funnel) }))
    .sort((a, b) => b.planned - a.planned || a.key.localeCompare(b.key));
}

export function failureBreakdown(facts: readonly TargetFact[]) {
  const counts = new Map<string, { reason: string; stage: string; count: number }>();
  for (const fact of facts) {
    const reason = fact.invalidReason ?? fact.failureReason;
    if (!reason) continue;
    const stage = fact.invalidReason
      ? 'INVALID_TARGET'
      : fact.events.has('DELIVERED')
        ? 'DISPLAY_FAILED'
        : 'SEND_FAILED';
    const key = `${stage}:${reason}`;
    const entry = counts.get(key) ?? { reason, stage, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count);
}
