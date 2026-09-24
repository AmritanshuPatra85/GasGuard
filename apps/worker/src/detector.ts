/**
 * GasGuard detector — LAYERS 1-5: deviation + persistence + rate-of-rise +
 * escalation levels + hysteresis/recovery + sensor-fault detection.
 *
 * A pure function: no DB, no MQTT, no clock. Everything it needs comes in
 * through its arguments, so a test can replay hours of readings in
 * milliseconds and get the same answer every time.
 *
 * Per reading, in order:
 *   0. Reject non-finite, stale and physically impossible (out-of-range) readings.
 *   1. Sensor-pattern checks (stuck / spiky) and the fault lifecycle.
 *   2. Score it against the baseline (z-score and relative deviation).
 *   3. Grade it: severity 0 (normal) to 3 (critical-grade), from the worst of
 *      the relative deviation, the rate of rise, and an absolute backstop.
 *   4. Persistence: a level is only entered after N CONSECUTIVE readings of
 *      at least that severity, so one spike can never escalate.
 *   5. Recovery (hysteresis): an open incident is only closed after
 *      recoveryPersistence CONSECUTIVE calm readings, where "calm" is a much
 *      tighter test than "abnormal". The gap between the two is the hysteresis
 *      band: readings inside it neither open nor close anything.
 *   6. Baseline learning is GATED: an abnormal reading, or any open level,
 *      freezes the baseline so a leak cannot be absorbed as "normal".
 *
 * Outputs the incident engine consumes:
 *   - result.transition:  a level change. `to` is a level, or 'RESOLVED'
 *     (incident recovered), or 'SENSOR_FAULT' (incident cancelled because the
 *     sensor is faulty). After RESOLVED / SENSOR_FAULT, state.level is NORMAL.
 *   - result.sensorEvent: FAULT_STARTED / FAULT_CLEARED, the sensor-health lifecycle.
 *
 * KNOWN LIMITATIONS (deliberate):
 *   - Levels never step DOWN one at a time: an open incident holds its level
 *     until it is RESOLVED (or cancelled as a sensor fault). Conservative for safety.
 *   - A drift too slow to reach the relative thresholds is absorbed by the
 *     EWMA. The absolute backstop is the last line of defence against it.
 *   - Levels are entered as soon as their persistence is met, so with the
 *     default config a sudden jump still passes through SUSPICIOUS (2 readings)
 *     one reading before CRITICAL (3). Equal persistence values would skip levels.
 *   - A stuck or spiky sensor cannot be told from a real leak until the pattern
 *     has lasted long enough to be visible (stuckReadings / spikeCount), so a
 *     stuck-high sensor can open an incident first and then cancel it.
 *     A flat reading at or above absoluteCritical is never cancelled.
 */

/** Below this, the baseline is treated as 1 so relative maths never divides by ~0. */
const MIN_BASELINE = 1;

export interface DetectorConfig {
  /** Readings used to learn the initial baseline. 24 readings = 2.4 min at 6 s. */
  readonly warmupReadings: number;
  /**
   * EWMA smoothing factor, 0 < alpha < 1. Time constant is about 1 / alpha
   * readings: alpha = 0.02 means about 50 readings = 5 min at 6 s.
   */
  readonly alpha: number;
  /**
   * Minimum sigma, as a fraction of the baseline. Stops a very quiet sensor
   * from producing huge z-scores on tiny wiggles.
   */
  readonly sigmaFloorRatio: number;

  /** A reading is only abnormal if its z-score is at least this (upward deviation only). */
  readonly zEnter: number;
  /** Relative rise over baseline that grades a reading severity 1 / 2 / 3. */
  readonly suspiciousRel: number;
  readonly warningRel: number;
  readonly criticalRel: number;

  /**
   * Rate-of-rise. A reading that is already abnormal AND sits on a rise steeper
   * than riseRatePerMin (fraction of baseline per minute, 0.25 = 25%/min) is
   * graded critical-grade. The slope is fitted over the last rateWindow readings.
   * If the gap between two readings exceeds windowMaxGapMs the window restarts.
   */
  readonly rateWindow: number;
  readonly riseRatePerMin: number;
  readonly windowMaxGapMs: number;

  /**
   * Absolute backstop, in the same units as the gas value. Applies regardless
   * of the learned baseline, so a leak present during warm-up or a slow drift
   * cannot be normalised away. Tune against the real sensor.
   */
  readonly absoluteWarning: number;
  readonly absoluteCritical: number;

  /** Consecutive readings of at least the given severity needed to enter each level. */
  readonly suspiciousPersistence: number;
  readonly warningPersistence: number;
  readonly criticalPersistence: number;

  /**
   * Layer 4: hysteresis. A reading is CALM (counts towards recovery) only if it
   * is graded normal AND its relative deviation is below exitRel AND it is below
   * absoluteWarning * exitAbsoluteRatio. exitRel must be smaller than suspiciousRel,
   * otherwise there is no hysteresis band.
   */
  readonly exitRel: number;
  readonly exitAbsoluteRatio: number;
  /** Consecutive calm readings needed to close an open incident. 10 = 1 min at 6 s. */
  readonly recoveryPersistence: number;

  /**
   * Layer 5: sensor health.
   * validMin / validMax: readings outside this range are physically impossible
   * (ADC fault, wiring, corrupt value). Set them to the range of gas.value for your sensor.
   */
  readonly validMin: number;
  readonly validMax: number;
  /** Consecutive out-of-range readings that confirm an INVALID fault. */
  readonly invalidPersistence: number;
  /**
   * STUCK: this many consecutive readings within stuckTolerance of each other.
   * A live analogue sensor is never this flat. Keep it above the number of
   * identical readings a legitimately quiet sensor could ever produce.
   */
  readonly stuckReadings: number;
  readonly stuckTolerance: number;
  /**
   * SPIKY: at least spikeCount "jumps" among the last spikeWindow readings, where a
   * jump is a change between consecutive readings larger than spikeJumpRel times
   * the smaller of the two. A real leak ramps; it does not ping-pong.
   */
  readonly spikeJumpRel: number;
  readonly spikeWindow: number;
  readonly spikeCount: number;
  /** Consecutive healthy readings needed to clear a fault. */
  readonly faultClearReadings: number;
}

export const DEFAULT_DETECTOR_CONFIG: DetectorConfig = {
  warmupReadings: 24,
  alpha: 0.02,
  sigmaFloorRatio: 0.02,

  zEnter: 3,
  suspiciousRel: 0.06,
  warningRel: 0.15,
  criticalRel: 0.3,

  rateWindow: 5,
  riseRatePerMin: 0.25,
  windowMaxGapMs: 60_000,

  absoluteWarning: 600,
  absoluteCritical: 1000,

  suspiciousPersistence: 2,
  warningPersistence: 3,
  criticalPersistence: 3,

  exitRel: 0.04,
  exitAbsoluteRatio: 0.9,
  recoveryPersistence: 10,

  validMin: 0,
  validMax: 4095,
  invalidPersistence: 3,
  stuckReadings: 20,
  stuckTolerance: 0.5,
  spikeJumpRel: 0.5,
  spikeWindow: 10,
  spikeCount: 4,
  faultClearReadings: 10,
};

export type DetectorPhase = 'WARMUP' | 'ACTIVE';
export type IncidentLevel = 'NORMAL' | 'SUSPICIOUS' | 'WARNING' | 'CRITICAL';
/** 0 = normal reading, 1 = suspicious-grade, 2 = warning-grade, 3 = critical-grade. */
export type Severity = 0 | 1 | 2 | 3;
export type SensorFault = 'INVALID' | 'STUCK' | 'SPIKY';
export type SensorEvent = 'FAULT_STARTED' | 'FAULT_CLEARED';
/** RESOLVED: incident recovered. SENSOR_FAULT: incident cancelled, the sensor is faulty. */
export type TransitionTarget = IncidentLevel | 'RESOLVED' | 'SENSOR_FAULT';

const LEVEL_RANK: Record<IncidentLevel, number> = {
  NORMAL: 0,
  SUSPICIOUS: 1,
  WARNING: 2,
  CRITICAL: 3,
};

/** One raw accepted reading, kept for the rate-of-rise window. */
export interface WindowPoint {
  readonly timestampMs: number;
  readonly value: number;
}

/** Treat as immutable: detect() never mutates it and always returns a new object. */
export interface DetectorState {
  readonly phase: DetectorPhase;
  /** Readings folded into the baseline. Frozen (abnormal) readings are not counted. */
  readonly count: number;
  /** Running mean during warm-up, EWMA baseline afterwards. */
  readonly baseline: number;
  /** Running variance (sample variance in warm-up, EWMA variance afterwards). */
  readonly variance: number;
  /** Welford sum of squared deviations. Warm-up scratch space only. */
  readonly m2: number;
  /** Timestamp of the last accepted reading, used to reject stale or duplicate ones. */
  readonly lastTimestampMs: number | null;
  /** The most recent raw readings (abnormal ones included), for the slope. */
  readonly window: readonly WindowPoint[];

  readonly level: IncidentLevel;
  /** Consecutive readings with severity >= 1 / >= 2 / >= 3. */
  readonly elevatedStreak: number;
  readonly warningStreak: number;
  readonly criticalStreak: number;
  /** Consecutive calm readings while an incident is open (layer 4). */
  readonly calmStreak: number;

  /** Layer 5. Last VALID value, for flat/jump checks. */
  readonly lastValue: number | null;
  /** Consecutive readings within stuckTolerance of the one before. */
  readonly flatStreak: number;
  /** Consecutive out-of-range readings. */
  readonly invalidStreak: number;
  /** Whether each of the last spikeWindow valid readings was a jump. */
  readonly jumpHistory: readonly boolean[];
  /** Active sensor fault, or null when the sensor is healthy. */
  readonly sensorFault: SensorFault | null;
  /** Consecutive healthy readings while a fault is active. */
  readonly healthyStreak: number;
}

export interface Reading {
  readonly timestampMs: number;
  readonly value: number;
}

export interface LevelTransition {
  readonly from: IncidentLevel;
  readonly to: TransitionTarget;
}

export interface DetectorResult {
  readonly state: DetectorState;
  /** (value - baseline) / sigma, scored against the baseline BEFORE this reading. null during warm-up or if ignored. */
  readonly zScore: number | null;
  /** (value - baseline) / baseline. null during warm-up or if ignored. */
  readonly relativeDeviation: number | null;
  /** Slope over the recent window as a fraction of baseline per minute. null during warm-up, or with under 3 points. */
  readonly ratePerMin: number | null;
  /** How abnormal this single reading was, before persistence. */
  readonly severity: Severity;
  /** Set only on the reading where the incident level changes, resolves, or is cancelled. */
  readonly transition: LevelTransition | null;
  /** Set only on the reading where a sensor fault starts or clears. */
  readonly sensorEvent: SensorEvent | null;
  /** Human-readable explanation of what happened on this reading. */
  readonly reasons: readonly string[];
}

export function createInitialState(): DetectorState {
  return {
    phase: 'WARMUP',
    count: 0,
    baseline: 0,
    variance: 0,
    m2: 0,
    lastTimestampMs: null,
    window: [],
    level: 'NORMAL',
    elevatedStreak: 0,
    warningStreak: 0,
    criticalStreak: 0,
    calmStreak: 0,
    lastValue: null,
    flatStreak: 0,
    invalidStreak: 0,
    jumpHistory: [],
    sensorFault: null,
    healthyStreak: 0,
  };
}

function ignored(prev: DetectorState, reason: string): DetectorResult {
  return {
    state: prev,
    zScore: null,
    relativeDeviation: null,
    ratePerMin: null,
    severity: 0,
    transition: null,
    sensorEvent: null,
    reasons: [reason],
  };
}

export function detect(
  prev: DetectorState,
  reading: Reading,
  config: DetectorConfig = DEFAULT_DETECTOR_CONFIG,
): DetectorResult {
  const { timestampMs, value } = reading;

  // A single NaN would poison the EWMA forever, so refuse it up front.
  if (!Number.isFinite(value) || !Number.isFinite(timestampMs)) {
    return ignored(prev, 'ignored: non-finite reading');
  }

  // Stale or duplicate reading (the worker enforces sequence order; this is a second line of defence).
  if (prev.lastTimestampMs !== null && timestampMs <= prev.lastTimestampMs) {
    return ignored(prev, 'ignored: timestamp not newer than last accepted reading');
  }

  // Layer 5: a physically impossible value says nothing about gas. Do not grade or learn it.
  if (value < config.validMin || value > config.validMax) {
    return rejectInvalid(prev, timestampMs, value, config);
  }

  const reasons: string[] = [];

  // Layer 5: sensor-pattern checks and the fault lifecycle.
  const pattern = checkPattern(prev, value, config);
  const fault = updateFault(prev, pattern.kind, config);
  const suppress = fault.sensorFault === 'STUCK' || fault.sensorFault === 'SPIKY';
  if (fault.event === 'FAULT_STARTED') {
    reasons.push(`sensor fault started: ${fault.sensorFault}`);
  } else if (fault.event === 'FAULT_CLEARED') {
    reasons.push(`sensor fault cleared after ${config.faultClearReadings} healthy readings`);
  }

  // 1. Score against the baseline (only once a baseline exists).
  const window = nextWindow(prev.window, reading, config);
  const scored = prev.phase === 'ACTIVE' ? score(prev, value, window, config) : null;

  // 2. Grade this single reading.
  const graded = grade(value, scored, config);
  const severity = graded.severity;
  if (graded.why !== null) reasons.push(`abnormal (severity ${severity}): ${graded.why}`);

  // While the sensor is STUCK or SPIKY its readings cannot open or raise an incident,
  // except a value at or above absoluteCritical, which is dangerous whatever the sensor says.
  const effective: Severity = suppress ? (value >= config.absoluteCritical ? 3 : 0) : severity;
  if (suppress && severity > 0 && effective === 0) {
    reasons.push('escalation suppressed: sensor fault active');
  }

  // 3. Persistence streaks and the level they justify.
  const elevatedStreak = effective >= 1 ? prev.elevatedStreak + 1 : 0;
  const warningStreak = effective >= 2 ? prev.warningStreak + 1 : 0;
  const criticalStreak = effective >= 3 ? prev.criticalStreak + 1 : 0;

  let level = escalate(prev.level, { elevatedStreak, warningStreak, criticalStreak }, config);
  let transition: LevelTransition | null =
    level !== prev.level ? { from: prev.level, to: level } : null;
  if (transition) {
    reasons.push(
      `level ${transition.from} -> ${transition.to} ` +
        `(streaks: elevated ${elevatedStreak}, warning ${warningStreak}, critical ${criticalStreak})`,
    );
  }

  // 4. Sensor fault cancels an open incident (never one at or above absoluteCritical).
  if (suppress && level !== 'NORMAL' && value < config.absoluteCritical) {
    transition = { from: level, to: 'SENSOR_FAULT' };
    reasons.push(`incident ${level} cancelled: ${fault.sensorFault} sensor, not a leak`);
    level = 'NORMAL';
  }

  // 5. Recovery with hysteresis. Only readings that are well clear count as calm.
  const wasOpen = prev.level !== 'NORMAL' && level === prev.level;
  const calm =
    !suppress &&
    severity === 0 &&
    value < config.absoluteWarning * config.exitAbsoluteRatio &&
    (scored === null || scored.relativeDeviation < config.exitRel);
  const calmStreak = wasOpen && calm ? prev.calmStreak + 1 : 0;
  if (wasOpen && calmStreak >= config.recoveryPersistence) {
    transition = { from: prev.level, to: 'RESOLVED' };
    reasons.push(`incident ${prev.level} resolved after ${calmStreak} calm readings`);
    level = 'NORMAL';
  }

  // 6. Gated baseline learning. A spiky sensor's readings never teach the baseline.
  const learned = learn(prev, value, severity, level, fault.sensorFault === 'SPIKY', config);
  if (learned.frozen) reasons.push('baseline frozen');
  if (learned.completedWarmup) {
    reasons.push(
      `warm-up complete: baseline ${learned.baseline.toFixed(1)}, sigma ${Math.sqrt(learned.variance).toFixed(1)}`,
    );
  } else if (prev.phase === 'WARMUP' && !learned.frozen) {
    reasons.push(`warm-up: learning baseline (${learned.count}/${config.warmupReadings})`);
  }

  const state: DetectorState = {
    phase: learned.phase,
    count: learned.count,
    baseline: learned.baseline,
    variance: learned.variance,
    m2: learned.m2,
    lastTimestampMs: timestampMs,
    window,
    level,
    elevatedStreak,
    warningStreak,
    criticalStreak,
    calmStreak,
    lastValue: value,
    flatStreak: pattern.flatStreak,
    invalidStreak: 0,
    jumpHistory: pattern.jumpHistory,
    sensorFault: fault.sensorFault,
    healthyStreak: fault.healthyStreak,
  };

  if (scored && reasons.length === 0) {
    reasons.push(
      `z=${scored.zScore.toFixed(2)}, deviation=${(scored.relativeDeviation * 100).toFixed(1)}% ` +
        `vs baseline ${prev.baseline.toFixed(1)}`,
    );
  }

  return {
    state,
    zScore: scored ? scored.zScore : null,
    relativeDeviation: scored ? scored.relativeDeviation : null,
    ratePerMin: scored ? scored.ratePerMin : null,
    severity,
    transition,
    sensorEvent: fault.event,
    reasons,
  };
}

/* ------------------------------------------------------------------ */
/* Layer 5: sensor health                                              */
/* ------------------------------------------------------------------ */

/**
 * An out-of-range reading. It is not graded, not windowed and not learned, and it does
 * not touch the incident level. Enough of them in a row confirm an INVALID fault.
 */
function rejectInvalid(
  prev: DetectorState,
  timestampMs: number,
  value: number,
  config: DetectorConfig,
): DetectorResult {
  const invalidStreak = prev.invalidStreak + 1;
  const started = prev.sensorFault === null && invalidStreak >= config.invalidPersistence;

  const reasons = [
    `invalid reading ${value}: outside [${config.validMin}, ${config.validMax}] (${invalidStreak} in a row), not graded`,
  ];
  if (started) reasons.push('sensor fault started: INVALID');

  return {
    state: {
      ...prev,
      lastTimestampMs: timestampMs,
      invalidStreak,
      sensorFault: started ? 'INVALID' : prev.sensorFault,
      healthyStreak: 0,
    },
    zScore: null,
    relativeDeviation: null,
    ratePerMin: null,
    severity: 0,
    transition: null,
    sensorEvent: started ? 'FAULT_STARTED' : null,
    reasons,
  };
}

interface Pattern {
  readonly flatStreak: number;
  readonly jumpHistory: readonly boolean[];
  /** The pattern this reading is part of, or null if it looks healthy. */
  readonly kind: 'STUCK' | 'SPIKY' | null;
}

/** Stuck (flat) and spiky (ping-pong) checks, from the history carried in state. */
function checkPattern(prev: DetectorState, value: number, config: DetectorConfig): Pattern {
  const last = prev.lastValue;
  const step = last === null ? null : Math.abs(value - last);

  const flatStreak = step !== null && step <= config.stuckTolerance ? prev.flatStreak + 1 : 0;

  const isJump =
    last !== null &&
    step !== null &&
    step > config.spikeJumpRel * Math.max(Math.min(last, value), MIN_BASELINE);
  const jumpHistory = [...prev.jumpHistory, isJump].slice(-config.spikeWindow);
  const jumps = jumpHistory.filter(Boolean).length;

  let kind: Pattern['kind'] = null;
  if (flatStreak >= config.stuckReadings - 1) kind = 'STUCK';
  else if (jumps >= config.spikeCount) kind = 'SPIKY';

  return { flatStreak, jumpHistory, kind };
}

interface FaultUpdate {
  readonly sensorFault: SensorFault | null;
  readonly healthyStreak: number;
  readonly event: SensorEvent | null;
}

/** Fault lifecycle: starts on a bad pattern, clears only after a run of healthy readings. */
function updateFault(
  prev: DetectorState,
  kind: Pattern['kind'],
  config: DetectorConfig,
): FaultUpdate {
  if (prev.sensorFault === null) {
    return kind === null
      ? { sensorFault: null, healthyStreak: 0, event: null }
      : { sensorFault: kind, healthyStreak: 0, event: 'FAULT_STARTED' };
  }
  if (kind !== null) {
    return { sensorFault: prev.sensorFault, healthyStreak: 0, event: null };
  }
  const healthyStreak = prev.healthyStreak + 1;
  if (healthyStreak >= config.faultClearReadings) {
    return { sensorFault: null, healthyStreak: 0, event: 'FAULT_CLEARED' };
  }
  return { sensorFault: prev.sensorFault, healthyStreak, event: null };
}

/* ------------------------------------------------------------------ */
/* Layers 1-3: scoring, grading, persistence                           */
/* ------------------------------------------------------------------ */

/** Minimum points needed to fit a slope. */
const MIN_RATE_POINTS = 3;

/** Append the reading, keep only the last rateWindow points, and restart after a long gap. */
function nextWindow(
  prev: readonly WindowPoint[],
  reading: Reading,
  config: DetectorConfig,
): readonly WindowPoint[] {
  const last = prev[prev.length - 1];
  const kept =
    last !== undefined && reading.timestampMs - last.timestampMs > config.windowMaxGapMs ? [] : prev;
  return [...kept, { timestampMs: reading.timestampMs, value: reading.value }].slice(-config.rateWindow);
}

/** Least-squares slope in gas units per SECOND, or null with too few points. */
function slopePerSecond(window: readonly WindowPoint[]): number | null {
  const first = window[0];
  if (first === undefined || window.length < MIN_RATE_POINTS) return null;

  const n = window.length;
  let sumT = 0;
  let sumV = 0;
  for (const p of window) {
    sumT += (p.timestampMs - first.timestampMs) / 1000;
    sumV += p.value;
  }
  const meanT = sumT / n;
  const meanV = sumV / n;

  let num = 0;
  let den = 0;
  for (const p of window) {
    const dt = (p.timestampMs - first.timestampMs) / 1000 - meanT;
    num += dt * (p.value - meanV);
    den += dt * dt;
  }
  return den > 0 ? num / den : null;
}

interface Scored {
  readonly zScore: number;
  readonly relativeDeviation: number;
  /** Slope as a fraction of baseline per minute, or null with too few points. */
  readonly ratePerMin: number | null;
}

/** Score against the baseline as it was BEFORE this reading, so a reading cannot dilute its own deviation. */
function score(
  prev: DetectorState,
  value: number,
  window: readonly WindowPoint[],
  config: DetectorConfig,
): Scored {
  const scale = Math.max(prev.baseline, MIN_BASELINE);
  const sigma = Math.max(Math.sqrt(prev.variance), config.sigmaFloorRatio * scale);
  const delta = value - prev.baseline;
  const slope = slopePerSecond(window);
  return {
    zScore: delta / sigma,
    relativeDeviation: delta / scale,
    ratePerMin: slope === null ? null : (slope * 60) / scale,
  };
}

interface Graded {
  readonly severity: Severity;
  readonly why: string | null;
}

function gradeAbsolute(value: number, config: DetectorConfig): Graded {
  if (value >= config.absoluteCritical) {
    return { severity: 3, why: `value ${value.toFixed(0)} >= absolute critical ${config.absoluteCritical}` };
  }
  if (value >= config.absoluteWarning) {
    return { severity: 2, why: `value ${value.toFixed(0)} >= absolute warning ${config.absoluteWarning}` };
  }
  return { severity: 0, why: null };
}

/** Upward deviations only: a drop is not a leak. */
function gradeRelative(scored: Scored | null, config: DetectorConfig): Graded {
  if (scored === null || scored.zScore < config.zEnter) return { severity: 0, why: null };

  const detail = `z=${scored.zScore.toFixed(1)}, +${(scored.relativeDeviation * 100).toFixed(1)}% over baseline`;
  if (scored.relativeDeviation >= config.criticalRel) return { severity: 3, why: detail };
  if (scored.relativeDeviation >= config.warningRel) return { severity: 2, why: detail };
  if (scored.relativeDeviation >= config.suspiciousRel) return { severity: 1, why: detail };
  return { severity: 0, why: null };
}

/**
 * A reading that is already abnormal AND on a steep rise is critical-grade: at
 * that pace it will pass the critical threshold within about a minute. The
 * abnormal-now gate stops noise, and the readings after a lone spike, from counting.
 */
function gradeRate(scored: Scored | null, config: DetectorConfig): Graded {
  if (
    scored === null ||
    scored.ratePerMin === null ||
    scored.zScore < config.zEnter ||
    scored.relativeDeviation < config.suspiciousRel ||
    scored.ratePerMin < config.riseRatePerMin
  ) {
    return { severity: 0, why: null };
  }
  return {
    severity: 3,
    why:
      `rising ${(scored.ratePerMin * 100).toFixed(0)}%/min ` +
      `(limit ${(config.riseRatePerMin * 100).toFixed(0)}%), +${(scored.relativeDeviation * 100).toFixed(1)}% over baseline`,
  };
}

/** The worst of the absolute, relative and rate grades wins. */
function grade(value: number, scored: Scored | null, config: DetectorConfig): Graded {
  let worst = gradeAbsolute(value, config);
  for (const candidate of [gradeRelative(scored, config), gradeRate(scored, config)]) {
    if (candidate.severity > worst.severity) worst = candidate;
  }
  return worst;
}

/** The highest level whose persistence is satisfied. Never goes down here; recovery is handled in detect(). */
function escalate(
  current: IncidentLevel,
  streaks: { elevatedStreak: number; warningStreak: number; criticalStreak: number },
  config: DetectorConfig,
): IncidentLevel {
  let candidate: IncidentLevel = 'NORMAL';
  if (streaks.criticalStreak >= config.criticalPersistence) candidate = 'CRITICAL';
  else if (streaks.warningStreak >= config.warningPersistence) candidate = 'WARNING';
  else if (streaks.elevatedStreak >= config.suspiciousPersistence) candidate = 'SUSPICIOUS';

  return LEVEL_RANK[candidate] > LEVEL_RANK[current] ? candidate : current;
}

interface Learned {
  readonly phase: DetectorPhase;
  readonly count: number;
  readonly baseline: number;
  readonly variance: number;
  readonly m2: number;
  /** True when this reading was deliberately NOT folded into the baseline. */
  readonly frozen: boolean;
  readonly completedWarmup: boolean;
}

/**
 * Decide whether this reading may teach the baseline.
 * Frozen (not learned) when the reading is abnormal, when any level is open,
 * or when the sensor is spiky. `severity` is the RAW grade, so a stuck-high
 * sensor (whose escalation is suppressed) still cannot teach its value.
 */
function learn(
  prev: DetectorState,
  value: number,
  severity: Severity,
  level: IncidentLevel,
  hold: boolean,
  config: DetectorConfig,
): Learned {
  const keep: Learned = {
    phase: prev.phase,
    count: prev.count,
    baseline: prev.baseline,
    variance: prev.variance,
    m2: prev.m2,
    frozen: true,
    completedWarmup: false,
  };

  if (severity > 0 || level !== 'NORMAL' || hold) return keep;

  if (prev.phase === 'WARMUP') {
    // Welford's online mean and variance.
    const count = prev.count + 1;
    const delta = value - prev.baseline;
    const mean = prev.baseline + delta / count;
    const m2 = prev.m2 + delta * (value - mean);
    const done = count >= config.warmupReadings;
    return {
      phase: done ? 'ACTIVE' : 'WARMUP',
      count,
      baseline: mean,
      variance: count > 1 ? m2 / (count - 1) : 0,
      m2,
      frozen: false,
      completedWarmup: done,
    };
  }

  // Standard incremental EWMA mean and variance.
  const delta = value - prev.baseline;
  const incr = config.alpha * delta;
  return {
    phase: 'ACTIVE',
    count: prev.count + 1,
    baseline: prev.baseline + incr,
    variance: (1 - config.alpha) * (prev.variance + delta * incr),
    m2: 0,
    frozen: false,
    completedWarmup: false,
  };
}