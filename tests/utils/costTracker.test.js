// tests/utils/costTracker.test.js
jest.mock('../../src/utils/logger', () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
}));

jest.mock('../../config/pipeline.config', () => ({
  costEstimates: {
    runway: 0.5,
    kling: 0.7,
    pika: 0.35,
    elevenlabs: 0.1,
    suno: 0.2,
    replicate: 0.15,
    openai: 0.02,
  },
  budgetTiers: [
    { name: 'Starter', monthlyUsd: 30, videosPerMonth: '4-5' },
    { name: 'Growth', monthlyUsd: 100, videosPerMonth: '16-20' },
    { name: 'Pro', monthlyUsd: 300, videosPerMonth: '55-65' },
  ],
}));

jest.mock(
  'fs-extra',
  () => ({
    ensureDir: jest.fn().mockResolvedValue(),
    pathExists: jest.fn(),
    readJson: jest.fn(),
    writeJson: jest.fn().mockResolvedValue(),
  }),
  { virtual: true }
);

const fs = require('fs-extra');
const costTracker = require('../../src/utils/costTracker');

describe('costTracker.recordRun', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fs.pathExists.mockResolvedValue(false); // log file doesn't exist yet
  });

  it('computes per-provider breakdown and total cost', async () => {
    const run = await costTracker.recordRun(
      { runway: 1, kling: 1, pika: 1, elevenlabs: 2, suno: 1, replicate: 1 },
      { exports: ['youtube', 'shorts'] }
    );

    expect(run.breakdown.runway).toEqual({ calls: 1, perCall: 0.5, cost: 0.5 });
    expect(run.breakdown.elevenlabs).toEqual({ calls: 2, perCall: 0.1, cost: 0.2 });
    // 0.5 + 0.7 + 0.35 + 0.2 + 0.2 + 0.15 = 2.1
    expect(run.total).toBeCloseTo(2.1, 4);
    expect(run.exports).toEqual(['youtube', 'shorts']);
    expect(run.timestamp).toBeDefined();
    expect(fs.writeJson).toHaveBeenCalledWith(
      expect.stringContaining('cost-log.json'),
      expect.objectContaining({ runs: [expect.objectContaining({ total: run.total })] }),
      { spaces: 2 }
    );
  });

  it('treats an unknown provider as zero cost', async () => {
    const run = await costTracker.recordRun({ mystery_provider: 5 });
    expect(run.breakdown.mystery_provider).toEqual({ calls: 5, perCall: 0, cost: 0 });
    expect(run.total).toBe(0);
  });

  it('appends to an existing log rather than overwriting it', async () => {
    fs.pathExists.mockResolvedValue(true);
    fs.readJson.mockResolvedValue({
      runs: [{ timestamp: '2026-01-01T00:00:00.000Z', total: 1.23, breakdown: {} }],
    });

    await costTracker.recordRun({ runway: 1 });

    const [, savedLog] = fs.writeJson.mock.calls[0];
    expect(savedLog.runs).toHaveLength(2);
    expect(savedLog.runs[0].total).toBe(1.23);
  });

  it('starts fresh if the log file is corrupted', async () => {
    fs.pathExists.mockResolvedValue(true);
    fs.readJson.mockRejectedValue(new Error('Unexpected token in JSON'));

    const run = await costTracker.recordRun({ runway: 1 });
    expect(run.total).toBe(0.5);

    const [, savedLog] = fs.writeJson.mock.calls[0];
    expect(savedLog.runs).toHaveLength(1);
  });
});

describe('costTracker.getSummary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns zeroed summary when no runs are logged', async () => {
    fs.pathExists.mockResolvedValue(false);
    const summary = await costTracker.getSummary();

    expect(summary.totalRuns).toBe(0);
    expect(summary.monthRuns).toBe(0);
    expect(summary.monthTotalUsd).toBe(0);
    expect(summary.allTimeTotalUsd).toBe(0);
    expect(summary.nearestBudgetTier.name).toBe('Starter');
    expect(summary.recentRuns).toEqual([]);
  });

  it('separates this-month spend from all-time spend', async () => {
    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 5).toISOString();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 2, 5).toISOString();

    fs.pathExists.mockResolvedValue(true);
    fs.readJson.mockResolvedValue({
      runs: [
        { timestamp: lastMonth, total: 10 },
        { timestamp: thisMonth, total: 5 },
        { timestamp: thisMonth, total: 7 },
      ],
    });

    const summary = await costTracker.getSummary();
    expect(summary.totalRuns).toBe(3);
    expect(summary.monthRuns).toBe(2);
    expect(summary.monthTotalUsd).toBe(12);
    expect(summary.allTimeTotalUsd).toBe(22);
  });

  it('picks the smallest budget tier that covers month-to-date spend', async () => {
    fs.pathExists.mockResolvedValue(true);
    const thisMonth = new Date().toISOString();
    fs.readJson.mockResolvedValue({
      runs: [{ timestamp: thisMonth, total: 45 }],
    });

    const summary = await costTracker.getSummary();
    expect(summary.nearestBudgetTier.name).toBe('Growth');
  });

  it('falls back to the highest tier when spend exceeds all tiers', async () => {
    fs.pathExists.mockResolvedValue(true);
    const thisMonth = new Date().toISOString();
    fs.readJson.mockResolvedValue({
      runs: [{ timestamp: thisMonth, total: 999 }],
    });

    const summary = await costTracker.getSummary();
    expect(summary.nearestBudgetTier.name).toBe('Pro');
  });

  it('returns only the 5 most recent runs', async () => {
    fs.pathExists.mockResolvedValue(true);
    const runs = Array.from({ length: 8 }, (_, i) => ({
      timestamp: new Date(2026, 0, i + 1).toISOString(),
      total: i,
    }));
    fs.readJson.mockResolvedValue({ runs });

    const summary = await costTracker.getSummary();
    expect(summary.recentRuns).toHaveLength(5);
    expect(summary.recentRuns[4].total).toBe(7);
  });
});
