import type { ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './shadcn/tabs';
import { SampleTag } from './SampleTag';

export interface LegendItem {
  label: string;
  /** A CSS colour, usually a token variable (`var(--color-series-1)`). */
  color: string;
  /** How the series is drawn, so the swatch matches it. */
  mark: 'line' | 'dash' | 'dots' | 'bar';
  /** The SVG dash pattern of a `dash` mark, so the swatch draws the same dashes. */
  dash?: string;
}

export interface ChartFrameProps {
  title: string;
  /** One sentence naming what the chart shows, read in place of the drawing. */
  summary: string;
  legend: LegendItem[];
  /** The data source line (spec: each data panel shows its source). */
  source: ReactNode;
  /** Sample data carries the MẪU tag. */
  sample?: boolean;
  chart: ReactNode;
  table: ReactNode;
}

function Swatch({ item }: { item: LegendItem }) {
  if (item.mark === 'dots') {
    return <span aria-hidden="true" className="size-2 rounded-full border-2 border-solid bg-surface" style={{ borderColor: item.color }} />;
  }
  if (item.mark === 'bar') return <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm" style={{ background: item.color }} />;
  return (
    <svg aria-hidden="true" width="18" height="4" className="shrink-0">
      <line x1="0" y1="2" x2="18" y2="2" stroke={item.color} strokeWidth="2" strokeDasharray={item.mark === 'dash' ? item.dash ?? '4 3' : undefined} />
    </svg>
  );
}

/**
 * The frame every chart sits in: a title with the MẪU tag for sample data, Biểu đồ · Bảng as
 * underline tabs, a legend naming every series, the chart or its table, and the source line.
 * The drawing is hidden from assistive technology behind its summary; the table carries the values.
 */
export function ChartFrame({ title, summary, legend, source, sample, chart, table }: ChartFrameProps) {
  return (
    <figure data-slot="chart-frame" aria-label={title} className="m-0 flex flex-col gap-1.5">
      <Tabs defaultValue="chart" className="gap-1.5">
        <div className="flex items-end justify-between gap-2">
          <figcaption className="flex items-center gap-1.5 pb-1.5 text-panel font-semibold text-ink">
            {title}
            {sample && <SampleTag />}
          </figcaption>
          <TabsList aria-label={`Dạng hiển thị: ${title}`} className="h-control-sm border-b-0">
            <TabsTrigger value="chart" className="text-label">Biểu đồ</TabsTrigger>
            <TabsTrigger value="table" className="text-label">Bảng</TabsTrigger>
          </TabsList>
        </div>
        <ul aria-label="Chú giải" className="m-0 flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-label text-ink-2">
          {legend.length > 0 && legend.map((item) => (
            <li key={item.label} className="inline-flex items-center gap-1.5"><Swatch item={item} />{item.label}</li>
          ))}
        </ul>
        <TabsContent value="chart">
          <p className="sr-only">{summary}</p>
          <div aria-hidden="true">{chart}</div>
        </TabsContent>
        <TabsContent value="table">{table}</TabsContent>
      </Tabs>
      <p className="m-0 text-label text-ink-2">Nguồn: {source}</p>
    </figure>
  );
}
