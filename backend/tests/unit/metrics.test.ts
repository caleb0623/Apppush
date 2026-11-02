import { describe, expect, it } from 'vitest';
import {
  addFact,
  computeLoss,
  computeRates,
  emptyFunnel,
  failureBreakdown,
  groupFacts,
  safeRate,
  type TargetFact,
} from '../../src/modules/analytics/metrics.js';

const funnel = { planned: 100, valid: 90, sent: 80, delivered: 60, displayed: 30, clicked: 6 };

const fact = (overrides: Partial<TargetFact> = {}): TargetFact => ({
  msgid: 'm',
  bucket: '2026-01-01',
  platform: 'ANDROID',
  channel: 'fcm',
  deliveryMode: 'SIMULATED',
  messageType: 'NOTIFICATION',
  appVersion: '1.0',
  isValid: true,
  invalidReason: null,
  failureReason: null,
  events: new Set(['SENT', 'DELIVERED']),
  ...overrides,
});

describe('rates', () => {
  it('uses delivered / sent for delivery rate', () => {
    expect(computeRates(funnel).deliveryRate).toBe(0.75);
  });

  it('uses displayed / delivered for display rate', () => {
    expect(computeRates(funnel).displayRate).toBe(0.5);
  });

  it('uses clicked / displayed for click-through rate', () => {
    expect(computeRates(funnel).clickThroughRate).toBe(0.2);
  });

  it('returns null rather than 0 for a zero denominator', () => {
    expect(computeRates(emptyFunnel())).toEqual({
      deliveryRate: null,
      displayRate: null,
      clickThroughRate: null,
    });
  });

  it('rounds to four decimal places', () => {
    expect(safeRate(1, 3)).toBe(0.3333);
  });
});

describe('loss', () => {
  it('reports the four stages, which sum to planned minus clicked', () => {
    const loss = computeLoss(funnel);
    expect(loss).toEqual({
      invalid: 10,
      notSent: 10,
      notDelivered: 20,
      notClicked: 54,
      notDisplayed: 30,
    });
    const { notDisplayed: _detail, ...stages } = loss;
    const total = Object.values(stages).reduce((sum, value) => sum + value, 0);
    expect(total).toBe(funnel.planned - funnel.clicked);
  });
});

describe('aggregation', () => {
  it('counts one target once per stage', () => {
    const totals = emptyFunnel();
    addFact(totals, fact());
    addFact(totals, fact({ isValid: false, events: new Set() }));
    expect(totals).toEqual({
      planned: 2,
      valid: 1,
      sent: 1,
      delivered: 1,
      displayed: 0,
      clicked: 0,
    });
  });

  it('groups by a dimension and ignores null keys', () => {
    const groups = groupFacts(
      [fact({ channel: 'fcm' }), fact({ channel: 'fcm' }), fact({ channel: 'apns' }), fact({ channel: null })],
      (f) => f.channel,
    );
    expect(groups.map((g) => [g.key, g.planned])).toEqual([
      ['fcm', 2],
      ['apns', 1],
    ]);
  });

  it('separates invalid targets from send failures', () => {
    const reasons = failureBreakdown([
      fact({ invalidReason: 'DEVICE_NOT_FOUND', isValid: false, events: new Set() }),
      fact({ failureReason: 'FCM_DOWN', events: new Set() }),
      fact({ failureReason: 'FCM_DOWN', events: new Set() }),
    ]);
    expect(reasons).toEqual([
      { reason: 'FCM_DOWN', stage: 'SEND_FAILED', count: 2 },
      { reason: 'DEVICE_NOT_FOUND', stage: 'INVALID_TARGET', count: 1 },
    ]);
  });

  it('attributes a failure after receipt to the display stage', () => {
    expect(failureBreakdown([fact({ failureReason: 'NOTIFICATIONS_DISABLED' })])).toEqual([
      { reason: 'NOTIFICATIONS_DISABLED', stage: 'DISPLAY_FAILED', count: 1 },
    ]);
  });
});
