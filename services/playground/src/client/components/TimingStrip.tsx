import type { ExecutionTiming } from "../../shared/types";

interface TimingStripProps {
  timing: ExecutionTiming;
}

export function TimingStrip({ timing }: TimingStripProps) {
  return (
    <section className="timing-grid" aria-label="Execution timing">
      <TimingCard label="Source" value={formatMs(timing.sourceQueryMs)} />
      <TimingCard label="Windowed" value={formatMs(timing.windowedQueryMs)} />
      <TimingCard label="Overhead" value={formatSignedMs(timing.windowOverheadMs)} />
      <TimingCard label="% of source" value={formatSignedPercent(timing.overheadPercentOfSource)} />
      <TimingCard label="Measurement" value={measurementLabel(timing.measurement)} />
    </section>
  );
}

function TimingCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="timing-card">
      <span className="timing-label">{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function measurementLabel(measurement: ExecutionTiming["measurement"]) {
  return measurement === "estimated-apoc" ? "APOC estimate" : "SQLite measured";
}

function formatMs(value: number) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  const abs = Math.abs(value);
  if (abs >= 1000) {
    return `${formatNumber(value / 1000)} s`;
  }
  return `${formatNumber(value)} ms`;
}

function formatSignedMs(value: number) {
  if (!Number.isFinite(value)) {
    return "n/a";
  }
  return `${value >= 0 ? "+" : "-"}${formatMs(Math.abs(value))}`;
}

function formatSignedPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "n/a";
  }
  const sign = value >= 0 ? "+" : "-";
  return `${sign}${formatNumber(Math.abs(value))}%`;
}

function formatNumber(value: number) {
  const abs = Math.abs(value);
  if (abs >= 100) {
    return value.toFixed(0);
  }
  if (abs >= 10) {
    return value.toFixed(1);
  }
  return value.toFixed(2);
}
