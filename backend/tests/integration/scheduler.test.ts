import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  claimJob,
  executeJob,
  processDueJobs,
  recoverStaleJobs,
} from '../../src/modules/scheduler/service.js';
import {
  createApplication,
  harness,
  prisma,
  registerDevice,
  send,
  type Harness,
} from '../helpers.js';

const HOUR = 3_600_000;

describe('scheduled delivery', () => {
  let h: Harness;
  let envId: number;
  let appId: number;
  let url: string;
  let time: { now: Date };

  const future = () => new Date(time.now.getTime() + HOUR).toISOString();
  const advance = (ms: number) => {
    time.now = new Date(time.now.getTime() + ms);
  };
  const schedule = async (overrides: object = {}) =>
    (await send(h, envId, { scheduledAt: future(), ...overrides }).expect(201)).body.data;

  beforeEach(async () => {
    time = { now: new Date('2026-06-01T00:00:00Z') };
    h = await harness({ clock: () => time.now });
    ({ envId, appId } = await createApplication(h));
    url = `/api/v1/environments/${envId}`;
    await registerDevice(h, envId, { registrationId: 'device-1' });
  });

  it('creates a pending job and sends nothing yet', async () => {
    const message = await schedule();
    expect(message).toMatchObject({ status: 'PENDING', scheduleType: 'SCHEDULED' });
    expect(await prisma.messageTarget.count()).toBe(0);

    const jobs = await h.api.get(`${url}/schedules?status=PENDING`).expect(200);
    expect(jobs.body.meta.total).toBe(1);
    expect(jobs.body.data[0].message.msgid).toBe(message.msgid);
  });

  it('reads a local time in the application timezone', async () => {
    await h.api.patch(`/api/v1/apps/${appId}`, { timezone: 'Asia/Shanghai' }).expect(200);
    const message = await schedule({ scheduledAt: '2026-06-02T09:00' });
    expect(message.scheduledAt).toBe('2026-06-02T01:00:00.000Z');
  });

  it('rejects times in the past or too far ahead', async () => {
    const past = await send(h, envId, { scheduledAt: '2020-01-01T00:00:00Z' }).expect(400);
    expect(past.body.error.code).toBe('SCHEDULE_IN_PAST');
    const far = await send(h, envId, { scheduledAt: '2036-01-01T00:00:00Z' }).expect(400);
    expect(far.body.error.code).toBe('SCHEDULE_TOO_FAR');
    await send(h, envId, { scheduledAt: 'tomorrow' }).expect(400);
  });

  it('leaves jobs alone until they are due, then processes them', async () => {
    const message = await schedule();
    expect(await processDueJobs(h.deps, 'w1')).toBe(0);

    advance(HOUR + 1);
    expect(await processDueJobs(h.deps, 'w1')).toBe(1);

    const detail = (await h.api.get(`${url}/messages/${message.msgid}`).expect(200)).body.data;
    expect(detail.status).toBe('COMPLETED');
    expect(detail.funnel.delivered).toBe(1);
    expect(detail.job.status).toBe('COMPLETED');
    expect(detail.job.attempts).toBe(1);
  });

  it('resolves the audience when the job runs, not when it was created', async () => {
    await schedule();
    await registerDevice(h, envId, { registrationId: 'late-device' });
    advance(HOUR + 1);
    await processDueJobs(h.deps, 'w1');
    expect(await prisma.messageTarget.count()).toBe(2);
  });

  it('lets only one of several concurrent workers claim a job', async () => {
    const message = await schedule();
    advance(HOUR + 1);
    const job = await prisma.scheduledJob.findFirstOrThrow({
      where: { message: { msgid: message.msgid } },
    });
    const claims = await Promise.all(
      Array.from({ length: 10 }, (_, i) => claimJob(job.id, `w${i}`, time.now)),
    );
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it('delivers once when workers run at the same time', async () => {
    await schedule();
    advance(HOUR + 1);
    const processed = await Promise.all([
      processDueJobs(h.deps, 'w1'),
      processDueJobs(h.deps, 'w2'),
      processDueJobs(h.deps, 'w3'),
    ]);
    expect(processed.reduce((a, b) => a + b, 0)).toBe(1);
    expect(await prisma.deliveryAttempt.count()).toBe(1);
    expect(await prisma.messageEvent.count({ where: { type: 'DELIVERED' } })).toBe(1);
  });

  it('recovers a job orphaned by a crash and finishes it', async () => {
    const message = await schedule();
    advance(HOUR + 1);
    const job = await prisma.scheduledJob.findFirstOrThrow();
    await claimJob(job.id, 'crashed-worker', time.now);
    expect(await processDueJobs(h.deps, 'w2')).toBe(0);

    advance(5 * 60_000);
    expect(await recoverStaleJobs(h.deps, 60_000)).toBe(1);
    expect(await processDueJobs(h.deps, 'w2')).toBe(1);
    const detail = (await h.api.get(`${url}/messages/${message.msgid}`)).body.data;
    expect(detail).toMatchObject({ status: 'COMPLETED' });
    expect(detail.job.attempts).toBe(2);
  });

  it('leaves a job alone while it is still fresh', async () => {
    await schedule();
    advance(HOUR + 1);
    const job = await prisma.scheduledJob.findFirstOrThrow();
    await claimJob(job.id, 'busy-worker', time.now);
    advance(1000);
    expect(await recoverStaleJobs(h.deps, 60_000)).toBe(0);
  });

  it('fails a job once its attempts are used up', async () => {
    const message = await schedule();
    advance(HOUR + 1);
    const job = await prisma.scheduledJob.findFirstOrThrow();
    await prisma.scheduledJob.update({
      where: { id: job.id },
      data: { status: 'PROCESSING', lockedAt: time.now, attempts: job.maxAttempts },
    });
    advance(5 * 60_000);
    await recoverStaleJobs(h.deps, 60_000);
    const detail = (await h.api.get(`${url}/messages/${message.msgid}`)).body.data;
    expect(detail.status).toBe('FAILED');
    expect(detail.job.status).toBe('FAILED');
  });

  it('retries after an infrastructure error, with a delay, up to the limit', async () => {
    await schedule();
    advance(HOUR + 1);
    const job = await prisma.scheduledJob.findFirstOrThrow();
    // The first clock read is the usability check; the second is inside dispatch.
    const clock = vi
      .fn(() => time.now)
      .mockImplementationOnce(() => time.now)
      .mockImplementationOnce(() => {
        throw new Error('transient failure');
      });
    await claimJob(job.id, 'w1', time.now);
    await executeJob({ ...h.deps, clock }, job.id);

    const retried = await prisma.scheduledJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(retried).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'transient failure' });
    expect(retried.runAt.getTime()).toBeGreaterThan(time.now.getTime());
  });

  it('fails instead of sending when the app was deactivated before the job ran', async () => {
    const message = await schedule();
    await h.api.post(`/api/v1/apps/${appId}/deactivate`).expect(200);
    advance(HOUR + 1);
    await processDueJobs(h.deps, 'w1');
    const detail = (await h.api.get(`${url}/messages/${message.msgid}`)).body.data;
    expect(detail.status).toBe('FAILED');
    expect(detail.failureReason).toMatch(/deactivated/);
    expect(await prisma.deliveryAttempt.count()).toBe(0);
  });

  it('cancels a pending job, which then never runs', async () => {
    const message = await schedule();
    const job = await prisma.scheduledJob.findFirstOrThrow();
    const res = await h.api.post(`${url}/schedules/${job.id}/cancel`).expect(200);
    expect(res.body.data.status).toBe('CANCELLED');
    advance(HOUR + 1);
    expect(await processDueJobs(h.deps, 'w1')).toBe(0);
    const detail = (await h.api.get(`${url}/messages/${message.msgid}`)).body.data;
    expect(detail.status).toBe('CANCELLED');
  });

  it('refuses to cancel a finished job or one from another environment', async () => {
    await schedule();
    const job = await prisma.scheduledJob.findFirstOrThrow();
    const other = await createApplication(h, 'Other');
    await h.api.post(`/api/v1/environments/${other.envId}/schedules/${job.id}/cancel`).expect(404);

    advance(HOUR + 1);
    await processDueJobs(h.deps, 'w1');
    const res = await h.api.post(`${url}/schedules/${job.id}/cancel`).expect(409);
    expect(res.body.error.code).toBe('JOB_NOT_CANCELLABLE');
  });

  it('finishes an immediate message left unclaimed by a crashed API', async () => {
    const stuck = await prisma.pushMessage.create({
      data: {
        msgid: 'left-behind',
        environmentId: envId,
        type: 'NOTIFICATION',
        title: 'T',
        body: 'B',
        platforms: ['ANDROID'],
        audienceType: 'ALL',
        audience: [],
        strategy: 'mtpush',
        requestHash: 'x',
        job: { create: { runAt: time.now } },
      },
    });
    expect(await processDueJobs(h.deps, 'w1')).toBe(1);
    expect(
      (await prisma.pushMessage.findUniqueOrThrow({ where: { id: stuck.id } })).status,
    ).toBe('COMPLETED');
  });
});
