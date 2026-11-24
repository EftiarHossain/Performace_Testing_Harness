// Renders a capacity analysis as a Markdown report with an SVG chart.
import { uslThroughput } from './capacity.js';

const INK = '#0b0b0b';
const MUTED = '#52514e';
const GRID = '#e4e3df';
const SURFACE = '#fcfcfb';
const SERIES = '#2a78d6';
const FONT = 'font-family="system-ui, -apple-system, Segoe UI, sans-serif"';
/**
 * A reference-line label on a surface-coloured plate, so it stays legible where a
 * line passes behind it. The plate is sized from an estimated text width because
 * SVG cannot measure text, and renderers differ in support for text outlines.
 * @param {number} x @param {number} y @param {string} text
 * @param {'start' | 'end'} anchor @param {string} fill
 */
function plateLabel(x, y, text, anchor, fill) {
  const width = text.length * 6.1 + 8;
  const left = anchor === 'end' ? x - width + 4 : x - 4;
  return (
    `<rect x="${left.toFixed(1)}" y="${(y - 11).toFixed(1)}" width="${width.toFixed(1)}" height="15" fill="${SURFACE}"/>` +
    `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-size="11" text-anchor="${anchor}" fill="${fill}" ${FONT}>${text}</text>`
  );
}

/** Round axis maximum up to a clean number with about five ticks. */
/** @param {number} max */
function axis(max) {
  const rough = (max || 1) / 5;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? rough;
  const top = Math.ceil((max || 1) / step) * step;
  const ticks = [];
  for (let value = 0; value <= top + step / 2; value += step)
    ticks.push(Math.round(value * 1e6) / 1e6);
  return { top, ticks };
}

/**
 * One panel: a single measured series against offered load, with optional
 * reference lines. Two measures get two panels, never two y-axes on one plot.
 * @param {object} p
 * @param {number} p.y  Top of the panel.
 * @param {string} p.title
 * @param {Array<{ x: number, y: number | null }>} p.points
 * @param {number} p.xMax
 * @param {(value: number) => string} p.label  Tooltip text for a point's value.
 * @param {{ value: number, text: string }} [p.horizontal]  Reference line at a y value.
 * @param {boolean} [p.diagonal]  Reference line y = x.
 * @param {{ value: number, text: string }} [p.vertical]  Marker at an x value.
 */
function panel(p) {
  const left = 64;
  const width = 620;
  const top = p.y + 34;
  const height = 190;
  const measured = p.points.filter((point) => point.y !== null);
  const yAxis = axis(
    Math.max(...measured.map((point) => /** @type {number} */ (point.y)), p.horizontal?.value ?? 0),
  );
  const xAxis = axis(p.xMax);
  const sx = (/** @type {number} */ v) => left + (v / xAxis.top) * width;
  const sy = (/** @type {number} */ v) => top + height - (v / yAxis.top) * height;
  const out = [
    `<text x="${left}" y="${p.y + 18}" font-size="14" font-weight="600" fill="${INK}" ${FONT}>${p.title}</text>`,
  ];

  for (const tick of yAxis.ticks) {
    out.push(
      `<line x1="${left}" x2="${left + width}" y1="${sy(tick)}" y2="${sy(tick)}" stroke="${GRID}" stroke-width="1"/>`,
      `<text x="${left - 8}" y="${sy(tick) + 4}" font-size="11" text-anchor="end" fill="${MUTED}" ${FONT}>${tick}</text>`,
    );
  }
  for (const tick of xAxis.ticks) {
    out.push(
      `<text x="${sx(tick)}" y="${top + height + 16}" font-size="11" text-anchor="middle" fill="${MUTED}" ${FONT}>${tick}</text>`,
    );
  }
  out.push(
    `<text x="${left + width}" y="${top + height + 32}" font-size="11" text-anchor="end" fill="${MUTED}" ${FONT}>offered load (transactions/s)</text>`,
  );

  // Labels are collected and drawn after every line, so no reference line strikes through a label.
  /** @type {string[]} */
  const labels = [];
  const dash = `stroke="${MUTED}" stroke-width="1" stroke-dasharray="4 4"`;
  if (p.diagonal) {
    const end = Math.min(xAxis.top, yAxis.top);
    out.push(`<line x1="${sx(0)}" y1="${sy(0)}" x2="${sx(end)}" y2="${sy(end)}" ${dash}/>`);
    labels.push(
      plateLabel(
        sx(end / 2) + 12,
        sy(end / 2) + 28,
        'ideal: all offered load served',
        'start',
        MUTED,
      ),
    );
  }
  if (p.horizontal) {
    out.push(
      `<line x1="${left}" x2="${left + width}" y1="${sy(p.horizontal.value)}" y2="${sy(p.horizontal.value)}" ${dash}/>`,
    );
    labels.push(
      plateLabel(left + 6, sy(p.horizontal.value) - 5, p.horizontal.text, 'start', MUTED),
    );
  }
  if (p.vertical) {
    out.push(
      `<line x1="${sx(p.vertical.value)}" x2="${sx(p.vertical.value)}" y1="${top}" y2="${top + height}" ${dash}/>`,
    );
    labels.push(plateLabel(sx(p.vertical.value) - 6, top + 12, p.vertical.text, 'end', INK));
  }

  const path = measured
    .map(
      (point, i) =>
        `${i === 0 ? 'M' : 'L'}${sx(point.x).toFixed(1)},${sy(/** @type {number} */ (point.y)).toFixed(1)}`,
    )
    .join(' ');
  out.push(
    `<path d="${path}" fill="none" stroke="${SERIES}" stroke-width="2" stroke-linejoin="round"/>`,
  );
  for (const point of measured) {
    // The surface-coloured ring keeps overlapping markers distinguishable; <title> gives a native tooltip.
    out.push(
      `<circle cx="${sx(point.x).toFixed(1)}" cy="${sy(/** @type {number} */ (point.y)).toFixed(1)}" r="4" fill="${SERIES}" stroke="${SURFACE}" stroke-width="2">` +
        `<title>offered ${point.x}/s: ${p.label(/** @type {number} */ (point.y))}</title></circle>`,
    );
  }
  out.push(...labels);
  return out.join('\n');
}

/** @param {ReturnType<typeof import('./capacity-analysis.js').analyseCapacity>} analysis */
export function renderChart(analysis) {
  const { steps, knee } = analysis;
  const xMax = Math.max(...steps.map((step) => step.offered));
  const kneeMark =
    knee.knee && knee.status === 'found'
      ? { value: knee.knee.offered, text: `knee ${knee.knee.offered}/s` }
      : undefined;
  const limit = analysis.criteria.p95;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 560" width="720" height="560" role="img" aria-label="Throughput and p95 latency against offered load">`,
    `<rect width="720" height="560" fill="${SURFACE}"/>`,
    panel({
      y: 8,
      title: 'Successful throughput (transactions/s)',
      points: steps.map((step) => ({ x: step.offered, y: step.throughput })),
      xMax,
      label: (v) => `${v.toFixed(1)}/s served`,
      diagonal: true,
      vertical: kneeMark,
    }),
    panel({
      y: 284,
      title: 'p95 latency of successful transactions (ms)',
      points: steps.map((step) => ({ x: step.offered, y: step.p95Ms })),
      xMax,
      label: (v) => `p95 ${Math.round(v)} ms`,
      horizontal: limit === undefined ? undefined : { value: limit, text: `SLO p95 ${limit} ms` },
      vertical: kneeMark,
    }),
    '</svg>',
  ].join('\n');
}

/** @param {number | null | undefined} value @param {number} [digits] */
const n = (value, digits = 0) =>
  value === null || value === undefined ? '-' : value.toFixed(digits);

/**
 * @param {ReturnType<typeof import('./capacity-analysis.js').analyseCapacity>} analysis
 * @param {{ chartFile: string }} options
 */
export function renderMarkdown(analysis, options) {
  const { run, steps, knee, saturation, usl, sizing, inputs } = analysis;
  const lines = [
    `# Capacity report: ${run.service}`,
    '',
    `Run \`${run.id}\`, environment \`${run.environment}\`, workload model version ${run.workloadVersion} ` +
      `(hash \`${run.workloadHash}\`), k6 ${run.k6Version}, commit \`${run.gitCommit ?? 'unknown'}\`.`,
    '',
  ];
  if (run.timeScale < 1) {
    lines.push(
      `> **Development run.** Stages were shortened with time-scale ${run.timeScale}. Short holds do not reach a ` +
        'true steady state, so treat these numbers as a rehearsal, not as a capacity statement.',
      '',
    );
  }

  lines.push('## Summary', '');
  if (knee.status === 'found' && knee.knee && knee.firstBeyond && sizing) {
    lines.push(
      `- **Knee: ${n(knee.knee.throughput, 1)} transactions/s.** The last load level handled within limits was ` +
        `${knee.knee.offered}/s offered. At ${knee.firstBeyond.offered}/s it was not: ${knee.firstBeyond.problems.join('; ')}.`,
      `- **Safe operating capacity: ${n(sizing.safeCapacity, 1)} transactions/s**, the knee less ${inputs.headroom * 100}% headroom.`,
      `- **Ceiling: ${n(saturation?.throughput, 1)} transactions/s** successful throughput, reached at ${saturation?.offered}/s offered. ` +
        'This is a limit, not an operating target: at the ceiling the system is already failing or queueing.',
      `- **Current peak demand of ${inputs.peakDemand}/s uses ${n(sizing.utilisationAtPeak * 100)}% of the knee** and is ` +
        `${sizing.peakWithinSafeCapacity ? 'within' : '**above**'} the safe operating capacity.`,
      `- **Sizing: ${sizing.instancesRecommended} instance(s)** for ${n(sizing.futureDemand, 1)}/s ` +
        `(peak x growth ${inputs.growthFactor}): ${sizing.instancesForLoad} for load plus ${inputs.redundantInstances} for redundancy.`,
    );
  } else if (knee.status === 'not-reached') {
    lines.push(
      `- **The knee was not reached.** Every level up to ${knee.knee?.offered}/s was handled within limits, so capacity is ` +
        `at least ${n(knee.knee?.throughput, 1)} transactions/s. Extend the profile to higher load to find the limit.`,
      '- No safe operating capacity or sizing is stated, because the limit is unknown.',
    );
  } else if (knee.status === 'below-range') {
    lines.push(
      `- **The system was already outside its limits at the lowest level tested** (${knee.firstBeyond?.offered}/s: ` +
        `${knee.firstBeyond?.problems.join('; ')}). Start the profile at a lower load.`,
    );
  } else {
    lines.push('- **No completed steady-state load level**, so there is nothing to analyse.');
  }

  lines.push(
    '',
    '## Load levels',
    '',
    `![Throughput and p95 latency against offered load](${options.chartFile})`,
    '',
    '| Offered /s | Served ok /s | Failed % | avg ms | p95 ms | p99 ms | In system | Within limits |',
    '| ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
    ...steps.map(
      (step) =>
        `| ${step.offered} | ${n(step.throughput, 1)} | ${n(step.failedRate * 100, 2)} | ${n(step.avgMs)} | ${n(step.p95Ms)} | ` +
        `${n(step.p99Ms)} | ${n(step.concurrency, 1)} | ${step.problems.length === 0 ? 'yes' : `no: ${step.problems.join('; ')}`} |`,
    ),
    '',
    '"In system" is the mean number of transactions in progress, from Little\'s law (served rate x mean latency). ' +
      'Latency covers successful transactions only.',
    '',
    '## Scalability model (USL)',
    '',
  );
  if (usl.ok) {
    lines.push(
      `Fitted on ${usl.points} load levels: throughput(N) = lambda N / (1 + sigma (N - 1) + kappa N (N - 1)), N = transactions in the system.`,
      '',
      '| Parameter | Value | Meaning |',
      '| --- | ---: | --- |',
      `| lambda | ${n(usl.lambda, 2)} | throughput per unit of concurrency with no contention |`,
      `| sigma | ${n(usl.sigma, 4)} | contention: share of work that queues for a shared resource |`,
      `| kappa | ${n(usl.kappa, 6)} | coherency: cost of coordination, which makes throughput fall past a peak |`,
      `| R squared | ${n(usl.rSquared, 3)} | how well the model explains the measured throughput |`,
      `| Worst miss | ${n(usl.maxRelativeError * 100)}% | largest gap between model and measurement at any load level |`,
      `| Predicted maximum | ${usl.peakThroughput === null ? 'unbounded (no contention found)' : `${n(usl.peakThroughput, 1)}/s`} | ` +
        `${usl.peakConcurrency === null ? 'asymptote lambda / sigma' : `at about ${n(usl.peakConcurrency)} in system`} |`,
      '',
    );
    if (usl.rSquared < 0.9 || usl.maxRelativeError > 0.1) {
      lines.push(
        `**The model does not describe this system well** (R squared ${n(usl.rSquared, 3)}, worst miss ` +
          `${n(usl.maxRelativeError * 100)}% of measured throughput). USL describes gradual loss of scalability; a system that ` +
          'scales linearly and then hits a hard limit (a fixed pool, a rate limiter, a queue bound) is not well described by it. ' +
          'Use the measured knee, not the predicted maximum.',
        '',
      );
    }
    lines.push(
      '| In system | Measured ok /s | Model ok /s |',
      '| ---: | ---: | ---: |',
      ...steps
        .filter((step) => step.concurrency !== null && step.throughput > 0)
        .map(
          (step) =>
            `| ${n(step.concurrency, 1)} | ${n(step.throughput, 1)} | ${n(uslThroughput(usl, /** @type {number} */ (step.concurrency)), 1)} |`,
        ),
      '',
    );
  } else {
    lines.push(`No USL model was fitted: ${usl.reason}.`, '');
  }

  lines.push(
    '## Assumptions and limits of this analysis',
    '',
    `- A load level is within limits when p95 < ${analysis.criteria.p95 ?? '-'} ms${analysis.criteria.p99 === undefined ? '' : `, p99 < ${analysis.criteria.p99} ms`}, ` +
      `failed share < ${analysis.criteria.errorRate * 100}% and served throughput is at least ${analysis.criteria.minEfficiency * 100}% of offered. ` +
      "The latency and error limits are the service's default SLO, applied to all transactions together.",
    `- The knee is the highest tested level within limits, so it is accurate only to the step size ` +
      `(${steps.length > 1 ? `${(steps[1]?.offered ?? 0) - (steps[0]?.offered ?? 0)}/s` : 'one level'}). The true limit lies between the knee and the next level.`,
    '- The result holds for this workload mix, data volume and environment. A different mix has a different capacity.',
    `- Sizing assumes capacity grows linearly with instance count and that the test ran against ${inputs.instancesTested} instance(s). ` +
      'That stops being true when a shared dependency (database, cache, network, downstream service) becomes the bottleneck.',
    '- The load test identifies where the limit is, not which resource causes it. Confirm the limiting resource from ' +
      'server-side utilisation and saturation metrics for the same time window before acting on the sizing.',
    '- One run is one sample. Repeat the run before committing to a number.',
    '',
  );
  if (analysis.validityNotes.length > 0) {
    lines.push('## Run validity', '', ...analysis.validityNotes.map((note) => `- ${note}`), '');
  }
  return lines.join('\n');
}
