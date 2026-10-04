import type { BuildReport } from '../runner';

/** The build summary, shared by atlas:build and atlas:up. Sets a failing exit code on any failure. */
export function printBuildReport(report: BuildReport): void {
  console.log(`executed ${report.executed.length}, skipped ${report.skipped.length}`);
  for (const s of report.executed) console.log(`  built   ${s}`);
  for (const s of report.failed) console.log(`  FAILED  ${s}: ${report.errors[s]}`);
  for (const s of report.blocked) console.log(`  blocked ${s} (not run)`);
  if (report.failed.length > 0 || report.blocked.length > 0) process.exitCode = 1;
}
