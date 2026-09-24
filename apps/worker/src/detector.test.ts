import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DETECTOR_CONFIG,
  createInitialState,
  detect,
  type DetectorConfig,
  type DetectorResult,
} from './detector';

const INTERVAL_MS = 6_000;
const START_MS = 1_700_000_000_000;
const BASELINE = 400;
const WARMUP = DEFAULT_DETECTOR_CONFIG.warmupReadings;
const RECOVERY = DEFAULT_DETECTOR_CONFIG.recoveryPersistence;
const STUCK_N = DEFAULT_DETECTOR_CONFIG.stuckReadings;
const CLEAR_N = DEFAULT_DETECTOR_CONFIG.faultClearReadings;

/** Small seeded PRNG (mulberry32) so every run produces identical "random" data. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Same shape as the simulator's normal scenario: 400 +/- 10 uniform jitter. */
function jitter(rng: () => number): number {
  return (rng() - 0.5) * 20;
}

function normalValues(seed: number, n: number): number[] {
  const rng = mulberry32(seed);
  return Array.from({ length: n }, () => BASELINE + jitter(rng));
}

/** `n` readings around `level`, +/- 10 jitter. */
function around(seed: number, level: number, n: number): number[] {
  const rng = mulberry32(seed);
  return Array.from({ length: n }, () => level + jitter(rng));
}

/** `normalCount` normal readings, then `leakCount` readings rising by `slope` per reading. */
function rampValues(seed: number, normalCount: number, leakCount: number, slope: number): number[] {
  const rng = mulberry32(seed);
  const values: number[] = [];
  for (let i = 0; i < normalCount; i++) values.push(BASELINE + jitter(rng));
  for (let i = 1; i <= leakCount; i++) values.push(BASELINE + slope * i + jitter(rng));
  return values;
}

/** Feed values through detect() one by one, 6 s apart. Returns every result. */
function run(values: number[], config: DetectorConfig = DEFAULT_DETECTOR_CONFIG): DetectorResult[] {
  const results: DetectorResult[] = [];
  let state = createInitialState();
  values.forEach((value, i) => {
    const result = detect(state, { timestampMs: START_MS + i * INTERVAL_MS, value }, config);
    results.push(result);
    state = result.state;
  });
  return results;
}

/** The same detector with rate-of-rise switched off, to measure what it adds. */
const NO_RATE: DetectorConfig = { ...DEFAULT_DETECTOR_CONFIG, riseRatePerMin: Infinity };

type Transition = NonNullable<DetectorResult['transition']>;

/** Every level change, with the index of the reading where it happened. */
function transitionsOf(results: DetectorResult[]): ({ index: number } & Transition)[] {
  return results.flatMap((r, index) => (r.transition ? [{ index, ...r.transition }] : []));
}

/** Every sensor fault start/clear, with the index of the reading where it happened. */
function sensorEventsOf(results: DetectorResult[]) {
  return results.flatMap((r, index) => (r.sensorEvent ? [{ index, event: r.sensorEvent }] : []));
}

/* ------------------------------------------------------------------ */
/* Layer 1: warm-up and baseline                                       */
/* ------------------------------------------------------------------ */

describe('layer 1: warm-up', () => {
  it('stays in WARMUP with no scores until warmupReadings, then becomes ACTIVE', () => {
    const results = run(normalValues(1, WARMUP));

    for (const r of results.slice(0, WARMUP - 1)) {
      expect(r.state.phase).toBe('WARMUP');
      expect(r.zScore).toBeNull();
      expect(r.relativeDeviation).toBeNull();
    }
    expect(results[WARMUP - 1].state.phase).toBe('ACTIVE');
  });

  it('learns a baseline within 2% of the true level from warm-up alone', () => {
    const last = run(normalValues(1, WARMUP)).at(-1)!;
    expect(Math.abs(last.state.baseline - BASELINE) / BASELINE).toBeLessThan(0.02);
  });
});

describe('layer 1: purity and input safety', () => {
  it('does not mutate the previous state', () => {
    const prev = Object.freeze(run(normalValues(7, WARMUP + 5)).at(-1)!.state);
    const snapshot = { ...prev };

    detect(prev, { timestampMs: prev.lastTimestampMs! + INTERVAL_MS, value: 405 });

    expect(prev).toEqual(snapshot);
  });

  it('is deterministic: same input gives the same output', () => {
    const values = rampValues(9, 100, 60, 5);
    expect(run(values)).toEqual(run(values));
  });

  it('ignores NaN and Infinity without poisoning the baseline', () => {
    const warmed = run(normalValues(3, WARMUP + 10)).at(-1)!.state;
    const t = warmed.lastTimestampMs! + INTERVAL_MS;

    for (const bad of [NaN, Infinity, -Infinity]) {
      const r = detect(warmed, { timestampMs: t, value: bad });
      expect(r.state).toBe(warmed);
      expect(r.zScore).toBeNull();
      expect(r.reasons[0]).toMatch(/ignored/);
    }

    const after = detect(warmed, { timestampMs: t, value: 401 });
    expect(Number.isFinite(after.state.baseline)).toBe(true);
    expect(Number.isFinite(after.state.variance)).toBe(true);
  });

  it('ignores duplicate and out-of-order timestamps', () => {
    const warmed = run(normalValues(3, WARMUP + 10)).at(-1)!.state;
    const last = warmed.lastTimestampMs!;

    for (const ts of [last, last - INTERVAL_MS]) {
      const r = detect(warmed, { timestampMs: ts, value: 400 });
      expect(r.state).toBe(warmed);
      expect(r.reasons[0]).toMatch(/ignored/);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Layer 2: fixtures from the blueprint                                */
/* ------------------------------------------------------------------ */

describe('fixture: 2 hours normal', () => {
  it('1200 readings: baseline within 1%, every reading NORMAL, no transitions', () => {
    const results = run(normalValues(42, 1200));

    expect(Math.abs(results.at(-1)!.state.baseline - BASELINE) / BASELINE).toBeLessThan(0.01);
    expect(transitionsOf(results)).toEqual([]);
    expect(results.every((r) => r.state.level === 'NORMAL')).toBe(true);
    expect(results.every((r) => r.severity === 0)).toBe(true);

    const scored = results.filter((r) => r.zScore !== null);
    expect(scored).toHaveLength(1200 - WARMUP);
    expect(Math.max(...scored.map((r) => Math.abs(r.zScore!)))).toBeLessThan(3);
  });

  it('holds across 50 different seeds, not just one lucky one', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const results = run(normalValues(seed, 1200));
      expect(transitionsOf(results), `seed ${seed}`).toEqual([]);
      expect(sensorEventsOf(results), `seed ${seed}`).toEqual([]);
      expect(Math.abs(results.at(-1)!.state.baseline - BASELINE) / BASELINE, `seed ${seed}`).toBeLessThan(0.01);
    }
  });
});

describe('fixture: slow leak', () => {
  it('walks NORMAL -> SUSPICIOUS -> WARNING -> CRITICAL, in order, after the leak starts', () => {
    const leakStart = 100;
    const results = run(rampValues(5, leakStart, 120, 5)); // +5 units per reading

    const transitions = transitionsOf(results);
    expect(transitions.map((t) => `${t.from}->${t.to}`)).toEqual([
      'NORMAL->SUSPICIOUS',
      'SUSPICIOUS->WARNING',
      'WARNING->CRITICAL',
    ]);

    // No incident before the leak begins, and each step comes later than the last.
    expect(transitions[0].index).toBeGreaterThanOrEqual(leakStart);
    expect(transitions[1].index).toBeGreaterThan(transitions[0].index);
    expect(transitions[2].index).toBeGreaterThan(transitions[1].index);
  });

  it('holds across 50 seeds', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const transitions = transitionsOf(run(rampValues(seed, 100, 120, 5)));
      expect(transitions.map((t) => t.to), `seed ${seed}`).toEqual(['SUSPICIOUS', 'WARNING', 'CRITICAL']);
    }
  });

  it('freezes the baseline once abnormal, so the leak is not absorbed', () => {
    const results = run(rampValues(5, 100, 120, 5));
    const first = transitionsOf(results)[0];

    expect(results.at(-1)!.state.baseline).toBe(results[first.index].state.baseline);
    expect(Math.abs(results.at(-1)!.state.baseline - BASELINE)).toBeLessThan(30);
  });
});

describe('fixture: single spike', () => {
  it('one huge reading never opens a level and does not pollute the baseline', () => {
    const values = normalValues(11, 200);
    values[100] = 900;
    const results = run(values);

    expect(results[100].severity).toBeGreaterThanOrEqual(2); // it WAS graded abnormal...
    expect(transitionsOf(results)).toEqual([]); // ...but persistence stopped it escalating
    expect(results.at(-1)!.state.level).toBe('NORMAL');
    expect(Math.abs(results.at(-1)!.state.baseline - BASELINE) / BASELINE).toBeLessThan(0.01);
  });

  it('a repeated lone spike every 20 readings still never escalates', () => {
    const values = normalValues(12, 400);
    for (let i = 60; i < 400; i += 20) values[i] = 900;
    const results = run(values);
    expect(transitionsOf(results)).toEqual([]);
    expect(sensorEventsOf(results)).toEqual([]); // lone spikes are not a sensor fault either
  });

  it('a two-reading pulse can raise suspicion but never reaches CRITICAL', () => {
    const values = normalValues(13, 200);
    values[100] = 900;
    values[101] = 900;
    const levels = run(values).map((r) => r.state.level);
    expect(levels).not.toContain('CRITICAL');
  });
});

describe('fixture: rapid rise', () => {
  it('a sudden sustained jump reaches CRITICAL within the critical persistence window', () => {
    const rng = mulberry32(21);
    const values = [
      ...Array.from({ length: 100 }, () => BASELINE + jitter(rng)),
      ...Array.from({ length: 30 }, () => BASELINE + 300 + jitter(rng)),
    ];
    const results = run(values);
    const t = transitionsOf(results);

    // Nothing before the jump; it enters SUSPICIOUS first (2 readings), then CRITICAL (3).
    expect(t.map((x) => x.to)).toEqual(['SUSPICIOUS', 'CRITICAL']);
    expect(t[0].index).toBeGreaterThanOrEqual(100);
    expect(t[1].index).toBeLessThanOrEqual(100 + DEFAULT_DETECTOR_CONFIG.criticalPersistence - 1);
    expect(results.at(-1)!.state.level).toBe('CRITICAL');
  });
});

/* ------------------------------------------------------------------ */
/* Layer 2: the absolute backstop                                      */
/* ------------------------------------------------------------------ */

describe('absolute backstop', () => {
  it('flags a leak that is already present during warm-up, and never learns it as normal', () => {
    const rng = mulberry32(31);
    const values = Array.from({ length: 40 }, () => 700 + jitter(rng));
    const results = run(values);

    expect(results.at(-1)!.state.level).toBe('WARNING');
    expect(results.at(-1)!.state.phase).toBe('WARMUP'); // nothing was learned from the leak
    expect(results.at(-1)!.state.count).toBe(0);
  });

  it('flags a flat critical-level reading in a fresh device', () => {
    const results = run(Array.from({ length: 10 }, () => 1100));
    expect(results.at(-1)!.state.level).toBe('CRITICAL');
  });

  it('catches a drift too slow for the relative thresholds (the EWMA absorbs it)', () => {
    // +0.3 per reading: the baseline keeps pace, so relative grading never fires.
    const values = rampValues(41, 100, 1500, 0.3);
    const results = run(values);
    const t = transitionsOf(results);

    // Nothing fires while the drift is absorbed. The first transition can only come
    // from the absolute backstop, so the reading that triggers it is at or above it.
    expect(t.length).toBeGreaterThan(0);
    expect(values[t[0].index]).toBeGreaterThanOrEqual(DEFAULT_DETECTOR_CONFIG.absoluteWarning);
    // Once the backstop opens the incident the baseline freezes (near 585), so the
    // continuing climb is graded against it and can legitimately reach CRITICAL.
    expect(['WARNING', 'CRITICAL']).toContain(results.at(-1)!.state.level);
  });
});

/* ------------------------------------------------------------------ */
/* Layer 3: rate-of-rise                                               */
/* ------------------------------------------------------------------ */

describe('layer 3: rate-of-rise', () => {
  const criticalIndex = (results: DetectorResult[]) =>
    transitionsOf(results).find((t) => t.to === 'CRITICAL')?.index;

  it('measures the slope: +30 per 6 s reading on a 400 baseline is 75%/min', () => {
    // Noise-free, so the maths is exact: 5 u/s * 60 / 400 = 0.75.
    const values = [...Array.from({ length: 40 }, () => 400), ...Array.from({ length: 8 }, (_, i) => 400 + 30 * (i + 1))];
    const results = run(values);

    expect(results[39].ratePerMin).toBeCloseTo(0, 6); // flat before the leak
    expect(results[47].ratePerMin).toBeCloseTo(0.75, 6); // window is now entirely on the ramp
  });

  it('reports no rate during warm-up or with fewer than 3 points', () => {
    const results = run(normalValues(1, WARMUP + 3));
    expect(results.slice(0, WARMUP).every((r) => r.ratePerMin === null)).toBe(true);
    expect(results[WARMUP].ratePerMin).not.toBeNull();
  });

  it('escalates a fast ramp to CRITICAL sooner than deviation alone, across 50 seeds', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const values = rampValues(seed, 100, 40, 30); // +30 per reading = 75%/min
      const withRate = criticalIndex(run(values));
      const withoutRate = criticalIndex(run(values, NO_RATE));

      expect(withRate, `seed ${seed}`).toBeDefined();
      expect(withoutRate, `seed ${seed}`).toBeDefined();
      expect(withRate!, `seed ${seed}`).toBeLessThan(withoutRate!);
    }
  });

  it('stays out of the way of a slow leak: identical transitions with and without it', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const values = rampValues(seed, 100, 120, 5); // +5 per reading = 12.5%/min, under the 25% limit
      expect(transitionsOf(run(values)), `seed ${seed}`).toEqual(transitionsOf(run(values, NO_RATE)));
    }
  });

  it('never fires on normal data, however noisy the slope estimate', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const results = run(normalValues(seed, 1200));
      expect(results.every((r) => r.severity === 0), `seed ${seed}`).toBe(true);
    }
  });

  it('restarts the window after a long silence instead of fitting a line across the gap', () => {
    const warmed = run(normalValues(3, WARMUP + 10)).at(-1)!.state;
    const afterGap = detect(warmed, {
      timestampMs: warmed.lastTimestampMs! + 10 * 60_000,
      value: 450,
    });

    expect(afterGap.state.window).toHaveLength(1);
    expect(afterGap.ratePerMin).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Layer 4: hysteresis, recovery, RESOLVED                             */
/* ------------------------------------------------------------------ */

describe('layer 4: recovery', () => {
  it('slow leak then clean air: CRITICAL -> RESOLVED exactly recoveryPersistence calm readings later', () => {
    const leak = rampValues(51, 100, 120, 5);
    const results = run([...leak, ...around(52, BASELINE, 40)]);
    const t = transitionsOf(results);

    expect(t.map((x) => x.to)).toEqual(['SUSPICIOUS', 'WARNING', 'CRITICAL', 'RESOLVED']);
    expect(t[3].from).toBe('CRITICAL');
    expect(t[3].index).toBe(leak.length + RECOVERY - 1);
    expect(results.at(-1)!.state.level).toBe('NORMAL');
  });

  it('holds the level until the resolving reading (no early or partial de-escalation)', () => {
    const leak = rampValues(51, 100, 120, 5);
    const results = run([...leak, ...around(52, BASELINE, 40)]);

    for (let i = leak.length; i < leak.length + RECOVERY - 1; i++) {
      expect(results[i].state.level, `reading ${i}`).toBe('CRITICAL');
    }
  });

  it('resolves across 50 seeds', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const leak = rampValues(seed, 100, 120, 5);
      const t = transitionsOf(run([...leak, ...around(seed + 1000, BASELINE, 30)]));
      expect(t.map((x) => x.to), `seed ${seed}`).toEqual(['SUSPICIOUS', 'WARNING', 'CRITICAL', 'RESOLVED']);
    }
  });

  it('a short pulse that raised SUSPICIOUS is also resolved', () => {
    const values = [...normalValues(53, 100), ...around(54, 440, 10), ...around(55, BASELINE, 30)];
    const t = transitionsOf(run(values));
    expect(t.map((x) => `${x.from}->${x.to}`)).toEqual(['NORMAL->SUSPICIOUS', 'SUSPICIOUS->RESOLVED']);
  });

  it('after RESOLVED the baseline learns again and a new leak opens a fresh incident', () => {
    const values = [
      ...rampValues(56, 100, 120, 5),
      ...around(57, BASELINE, 60),
      ...rampValues(58, 0, 120, 5),
    ];
    const results = run(values);
    const t = transitionsOf(results);

    expect(t.map((x) => x.to)).toEqual([
      'SUSPICIOUS', 'WARNING', 'CRITICAL', 'RESOLVED',
      'SUSPICIOUS', 'WARNING', 'CRITICAL',
    ]);
    expect(results[100 + 120 + 59].state.count).toBeGreaterThan(30); // learning resumed
  });

  it('resolves an incident opened by the absolute backstop during warm-up, then finishes warm-up', () => {
    const values = [...around(59, 700, 40), ...around(60, BASELINE, 40)];
    const results = run(values);
    const t = transitionsOf(results);

    expect(t.map((x) => `${x.from}->${x.to}`)).toEqual([
      'NORMAL->SUSPICIOUS',
      'SUSPICIOUS->WARNING',
      'WARNING->RESOLVED',
    ]);
    const last = results.at(-1)!.state;
    expect(last.phase).toBe('ACTIVE');
    expect(Math.abs(last.baseline - BASELINE) / BASELINE).toBeLessThan(0.02);
  });

  it('never resolves while the leak is still present', () => {
    const results = run(rampValues(61, 100, 400, 5)); // climbs past 2000, never recovers
    expect(transitionsOf(results).map((x) => x.to)).toEqual(['SUSPICIOUS', 'WARNING', 'CRITICAL']);
  });
});

describe('layer 4: hysteresis (fixture: threshold oscillation)', () => {
  it('oscillating around the ENTRY threshold never opens an incident', () => {
    // 430 is suspicious-grade, 405 is normal: the streak resets every other reading.
    const values = normalValues(71, 100);
    for (let i = 0; i < 400; i++) values.push(i % 2 === 0 ? 430 : 405);
    const results = run(values);

    expect(transitionsOf(results)).toEqual([]);
    expect(results.at(-1)!.state.level).toBe('NORMAL');
  });

  it('oscillating inside the hysteresis band holds the level: no flapping, no resolve', () => {
    // 440 opens SUSPICIOUS. Then 405 (calm) alternates with 418 (not abnormal, not calm).
    const values = [...normalValues(72, 100), ...around(73, 440, 10)];
    for (let i = 0; i < 400; i++) values.push(i % 2 === 0 ? 405 : 418);
    const results = run(values);
    const t = transitionsOf(results);

    expect(t.map((x) => `${x.from}->${x.to}`)).toEqual(['NORMAL->SUSPICIOUS']);
    expect(results.at(-1)!.state.level).toBe('SUSPICIOUS');
  });

  it('a single non-calm reading restarts the recovery count', () => {
    const values = [
      ...normalValues(74, 100),
      ...around(75, 440, 10), // opens SUSPICIOUS
      ...around(76, BASELINE, RECOVERY - 1), // one short of resolving
      418, // inside the band: not calm
      ...around(77, BASELINE, RECOVERY - 1), // one short again
    ];
    const results = run(values);
    expect(transitionsOf(results).map((x) => x.to)).toEqual(['SUSPICIOUS']);

    // One more calm reading finally resolves it.
    const more = run([...values, BASELINE]);
    expect(transitionsOf(more).map((x) => x.to)).toEqual(['SUSPICIOUS', 'RESOLVED']);
  });

  it('config sanity: the exit threshold is tighter than the entry threshold', () => {
    expect(DEFAULT_DETECTOR_CONFIG.exitRel).toBeLessThan(DEFAULT_DETECTOR_CONFIG.suspiciousRel);
  });
});

/* ------------------------------------------------------------------ */
/* Layer 5: sensor faults                                              */
/* ------------------------------------------------------------------ */

describe('layer 5: sensor stuck high (fixture)', () => {
  it('is classified as a sensor fault, and the incident it opened is cancelled', () => {
    const values = [...normalValues(81, 100), ...Array.from({ length: 60 }, () => 900)];
    const results = run(values);
    const t = transitionsOf(results);
    const events = sensorEventsOf(results);

    expect(events).toEqual([{ index: 100 + STUCK_N - 1, event: 'FAULT_STARTED' }]);
    expect(t.map((x) => x.to)).toEqual(['SUSPICIOUS', 'CRITICAL', 'SENSOR_FAULT']);
    expect(t[2].from).toBe('CRITICAL');
    expect(t[2].index).toBe(events[0].index);

    const last = results.at(-1)!.state;
    expect(last.sensorFault).toBe('STUCK');
    expect(last.level).toBe('NORMAL');
    expect(Math.abs(last.baseline - BASELINE) / BASELINE).toBeLessThan(0.02); // 900 was never learned
  });

  it('a flat reading at or above absoluteCritical is flagged but the incident is NOT cancelled', () => {
    const values = [...normalValues(82, 100), ...Array.from({ length: 60 }, () => 1100)];
    const results = run(values);

    expect(sensorEventsOf(results).map((e) => e.event)).toEqual(['FAULT_STARTED']);
    expect(transitionsOf(results).map((x) => x.to)).toEqual(['SUSPICIOUS', 'CRITICAL']);
    expect(results.at(-1)!.state.sensorFault).toBe('STUCK');
    expect(results.at(-1)!.state.level).toBe('CRITICAL');
  });

  it('a stuck sensor that starts moving clears the fault, and a real leak behind it is caught again', () => {
    const values = [
      ...normalValues(83, 100),
      ...Array.from({ length: 30 }, () => 900), // stuck: cancelled at reading 119
      ...around(84, 900, 40), // sensor alive again, still reading 900
    ];
    const results = run(values);

    expect(sensorEventsOf(results)).toEqual([
      { index: 100 + STUCK_N - 1, event: 'FAULT_STARTED' },
      { index: 130 + CLEAR_N - 1, event: 'FAULT_CLEARED' },
    ]);
    expect(transitionsOf(results).map((x) => x.to)).toEqual([
      'SUSPICIOUS', 'CRITICAL', 'SENSOR_FAULT', 'SUSPICIOUS', 'CRITICAL',
    ]);
    expect(results.at(-1)!.state.level).toBe('CRITICAL');
  });
});

describe('layer 5: spiky sensor', () => {
  it('ping-pong readings are a sensor fault and never open an incident', () => {
    const values = [...normalValues(85, 100)];
    for (let i = 0; i < 30; i++) values.push(i % 2 === 0 ? 900 : 100);
    const results = run(values);

    expect(sensorEventsOf(results)).toEqual([
      { index: 100 + DEFAULT_DETECTOR_CONFIG.spikeCount - 1, event: 'FAULT_STARTED' },
    ]);
    expect(transitionsOf(results)).toEqual([]);
    expect(results.at(-1)!.state.sensorFault).toBe('SPIKY');
    expect(Math.abs(results.at(-1)!.state.baseline - BASELINE) / BASELINE).toBeLessThan(0.02);
  });

  it('clears after the sensor settles', () => {
    const values = [...normalValues(86, 100)];
    for (let i = 0; i < 12; i++) values.push(i % 2 === 0 ? 900 : 100);
    values.push(...normalValues(87, 60));
    const results = run(values);

    const events = sensorEventsOf(results).map((e) => e.event);
    expect(events).toEqual(['FAULT_STARTED', 'FAULT_CLEARED']);
    expect(results.at(-1)!.state.sensorFault).toBeNull();
    expect(transitionsOf(results)).toEqual([]);
  });
});

describe('layer 5: invalid readings', () => {
  it('a lone out-of-range reading is discarded without a fault or any state change', () => {
    const values = [...normalValues(88, 100), -50, ...normalValues(89, 50)];
    const results = run(values);

    expect(results[100].state.window).toEqual(results[99].state.window);
    expect(results[100].state.baseline).toBe(results[99].state.baseline);
    expect(results[100].severity).toBe(0);
    expect(results[100].reasons[0]).toMatch(/invalid/);
    expect(sensorEventsOf(results)).toEqual([]);
    expect(transitionsOf(results)).toEqual([]);
  });

  it('a run of invalid readings confirms an INVALID fault, which clears after healthy readings', () => {
    const values = [...normalValues(90, 100), -50, -50, -50, 99999, ...normalValues(91, 30)];
    const results = run(values);
    const invalidStart = 100 + DEFAULT_DETECTOR_CONFIG.invalidPersistence - 1;

    expect(sensorEventsOf(results)).toEqual([
      { index: invalidStart, event: 'FAULT_STARTED' },
      { index: 104 + CLEAR_N - 1, event: 'FAULT_CLEARED' },
    ]);
    expect(results[invalidStart].state.sensorFault).toBe('INVALID');
    expect(transitionsOf(results)).toEqual([]);
    expect(Math.abs(results.at(-1)!.state.baseline - BASELINE) / BASELINE).toBeLessThan(0.01);
  });

  it('invalid readings never cancel or advance a real incident', () => {
    const leak = [...normalValues(92, 100), ...around(93, 900, 10)]; // CRITICAL by the third reading
    const results = run([...leak, -50, -50, -50, -50, ...around(94, 900, 5)]);

    expect(results.at(-1)!.state.level).toBe('CRITICAL');
    expect(transitionsOf(results).map((x) => x.to)).toEqual(['SUSPICIOUS', 'CRITICAL']);
  });
});