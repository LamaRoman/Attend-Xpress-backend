/**
 * Alerter contract tests.
 *
 * The alerter is called from inside catch blocks. Its main contract is
 * "never throw, even when everything is on fire." These tests exercise
 * that contract more than they verify successful delivery — successful
 * delivery is the easy case.
 */

describe('alerter', () => {
  let originalFetch: typeof globalThis.fetch;
  let originalWebhookUrl: string | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalWebhookUrl = process.env.SLACK_ALERT_WEBHOOK_URL;
    // Force a fresh module load each test so the channel registry
    // re-evaluates against whatever we set on process.env.
    jest.resetModules();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalWebhookUrl === undefined) {
      delete process.env.SLACK_ALERT_WEBHOOK_URL;
    } else {
      process.env.SLACK_ALERT_WEBHOOK_URL = originalWebhookUrl;
    }
  });

  function loadAlerter() {
    // Lazy import after we've twiddled env so the module's top-level
    // channel registration runs against the test's config.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('../alerter').alerter as typeof import('../alerter').alerter;
  }

  it('does not throw when no channels are configured', async () => {
    delete process.env.SLACK_ALERT_WEBHOOK_URL;
    const alerter = loadAlerter();

    expect(alerter.isEnabled()).toBe(false);
    await expect(
      alerter.send({ source: 'test', title: 'unconfigured' })
    ).resolves.toBeUndefined();
  });

  it('posts to Slack when configured', async () => {
    process.env.SLACK_ALERT_WEBHOOK_URL = 'https://hooks.slack.com/test/abc';
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve('ok') });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const alerter = loadAlerter();
    alerter._resetRateLimits();

    await alerter.send({
      source: 'unit-test',
      title: 'something broke',
      severity: 'error',
      error: new Error('boom'),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://hooks.slack.com/test/abc');
    expect(init).toMatchObject({ method: 'POST' });
    const body = JSON.parse((init as { body: string }).body);
    expect(body.text).toContain('something broke');
    expect(body.text).toContain('boom');
    expect(body.text).toContain('unit-test');
  });

  it('does not throw when fetch rejects', async () => {
    process.env.SLACK_ALERT_WEBHOOK_URL = 'https://hooks.slack.com/test/abc';
    const fetchMock = jest.fn().mockRejectedValue(new Error('network down'));
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const alerter = loadAlerter();
    alerter._resetRateLimits();

    await expect(
      alerter.send({ source: 'unit-test', title: 'still going' })
    ).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not throw when fetch returns non-2xx', async () => {
    process.env.SLACK_ALERT_WEBHOOK_URL = 'https://hooks.slack.com/test/abc';
    const fetchMock = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      text: () => Promise.resolve('no_service'),
    });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const alerter = loadAlerter();
    alerter._resetRateLimits();

    await expect(
      alerter.send({ source: 'unit-test', title: 'webhook revoked' })
    ).resolves.toBeUndefined();
  });

  it('rate-limits repeat alerts from the same source', async () => {
    process.env.SLACK_ALERT_WEBHOOK_URL = 'https://hooks.slack.com/test/abc';
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve('ok') });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const alerter = loadAlerter();
    alerter._resetRateLimits();

    await alerter.send({ source: 'noisy-job', title: 'first' });
    await alerter.send({ source: 'noisy-job', title: 'second' });
    await alerter.send({ source: 'noisy-job', title: 'third' });

    // Only the first one should have made it through.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('rate-limits per source, not globally', async () => {
    process.env.SLACK_ALERT_WEBHOOK_URL = 'https://hooks.slack.com/test/abc';
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve('ok') });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const alerter = loadAlerter();
    alerter._resetRateLimits();

    await alerter.send({ source: 'job-a', title: 'a' });
    await alerter.send({ source: 'job-b', title: 'b' });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('handles non-Error thrown values gracefully', async () => {
    process.env.SLACK_ALERT_WEBHOOK_URL = 'https://hooks.slack.com/test/abc';
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, text: () => Promise.resolve('ok') });
    globalThis.fetch = fetchMock as unknown as typeof globalThis.fetch;

    const alerter = loadAlerter();
    alerter._resetRateLimits();

    // Cron handlers can throw strings, numbers, or objects.
    await alerter.send({ source: 'weird', title: 'string thrown', error: 'just a string' });
    await alerter.send({ source: 'weird-2', title: 'object thrown', error: { code: 42 } });
    await alerter.send({ source: 'weird-3', title: 'undefined error', error: undefined });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const firstBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(firstBody.text).toContain('just a string');
  });
});
