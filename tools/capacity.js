#!/usr/bin/env node
// Capacity analysis of a stair-step run: writes capacity-report.md, capacity.svg
// and capacity.json next to the run's result.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { analyseCapacity } from './lib/capacity-analysis.js';
import { renderChart, renderMarkdown } from './lib/capacity-report.js';
import { loadRun, ROOT } from './lib/runs.js';

const USAGE = `Usage: node tools/capacity.js <run> [options]

<run> is a run directory, a result.json file, or "latest". It should be a run of
a stair-step profile ("capacity").

Options (defaults from config/capacity.json and the workload model):
  --peak <rate>       Forecast peak demand in transactions/s (default: workload peakRate)
  --headroom <0..1>   Share of the knee kept in reserve
  --growth <factor>   Demand growth over the planning horizon
  --instances <n>     Instances behind the endpoint during the test
  --redundancy <n>    Extra instances for failure tolerance

Exit codes: 0 knee found, 1 no knee could be determined, 2 could not analyse.
`;

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      peak: { type: 'string' },
      headroom: { type: 'string' },
      growth: { type: 'string' },
      instances: { type: 'string' },
      redundancy: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help || positionals.length !== 1) {
    console.log(USAGE);
    process.exitCode = values.help ? 0 : 2;
  } else {
    const { result, file } = loadRun(/** @type {string} */ (positionals[0]));
    /** @param {string} relative */
    const readJson = (relative) => JSON.parse(readFileSync(path.join(ROOT, relative), 'utf8'));
    const serviceDir = `config/services/${result.run.service}`;
    const config = readJson('config/capacity.json');
    /** @param {string | undefined} raw @param {number} fallback @param {string} name */
    const number = (raw, fallback, name) => {
      if (raw === undefined) return fallback;
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error(`--${name} must be a number`);
      return value;
    };
    config.headroom = number(values.headroom, config.headroom, 'headroom');
    config.sizing.growthFactor = number(values.growth, config.sizing.growthFactor, 'growth');
    config.sizing.instancesTested = number(
      values.instances,
      config.sizing.instancesTested,
      'instances',
    );
    config.sizing.redundantInstances = number(
      values.redundancy,
      config.sizing.redundantInstances,
      'redundancy',
    );

    const analysis = analyseCapacity({
      result,
      slo: readJson(`${serviceDir}/slo.json`),
      config,
      peakDemand: number(values.peak, readJson(`${serviceDir}/workload.json`).peakRate, 'peak'),
    });

    const runDir = path.dirname(file);
    writeFileSync(path.join(runDir, 'capacity.svg'), `${renderChart(analysis)}\n`);
    writeFileSync(
      path.join(runDir, 'capacity-report.md'),
      renderMarkdown(analysis, { chartFile: 'capacity.svg' }),
    );
    writeFileSync(path.join(runDir, 'capacity.json'), `${JSON.stringify(analysis, null, 2)}\n`);

    const { knee, sizing, usl } = analysis;
    if (knee.status === 'found' && knee.knee && sizing) {
      console.log(
        `Knee: ${knee.knee.throughput.toFixed(1)}/s (last level within limits: ${knee.knee.offered}/s offered; ` +
          `beyond at ${knee.firstBeyond?.offered}/s)\n` +
          `Safe operating capacity: ${sizing.safeCapacity.toFixed(1)}/s (${config.headroom * 100}% headroom)\n` +
          `Ceiling: ${analysis.saturation?.throughput.toFixed(1)}/s\n` +
          `Instances recommended: ${sizing.instancesRecommended} for ${sizing.futureDemand.toFixed(1)}/s`,
      );
    } else {
      console.log(`No knee determined (${knee.status}); see the report for what to change.`);
    }
    console.log(
      usl.ok
        ? `USL: sigma=${usl.sigma.toFixed(4)} kappa=${usl.kappa.toFixed(6)} R2=${usl.rSquared.toFixed(3)}`
        : `USL: ${usl.reason}`,
    );
    console.log(`Report: ${path.relative(process.cwd(), path.join(runDir, 'capacity-report.md'))}`);
    process.exitCode = knee.status === 'found' ? 0 : 1;
  }
} catch (error) {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 2;
}
