import { useCallback, useEffect, useRef, useState } from 'react';
import type { AnalysisOp, AnalysisResult, GeoJsonGeometry, MapCommand } from '@webatlas/shared';
import { ApiError } from '../../../shared/api/apiClient';
import type { DrawKind } from '../../map/model/analysisDraw';
import { setLastShape } from '../../map/model/lastShape';
import { runAnalysis } from '../api/analysis.api';
import { DEFAULT_PARAMS, acceptsShape, buildInput, drawKindFor, ANALYSIS_TOOL_LABELS, type AnalysisParams } from './tools';
import { downloadCsv } from './csv';
import { setAnalysisResult } from './analysisResult.store';

export interface UseAnalysisDeps {
  startDraw: (kind: DrawKind, onDone: (g: GeoJsonGeometry) => void) => () => void;
  run: (cmd: MapCommand) => unknown;
  getLastShape: () => GeoJsonGeometry | null;
  fetchResult?: typeof runAnalysis;
}

export type AnalysisStatus = 'idle' | 'params' | 'drawing' | 'running';

export function useAnalysis({ startDraw, run, getLastShape, fetchResult = runAnalysis }: UseAnalysisDeps) {
  const [active, setActive] = useState<AnalysisOp | null>(null);
  const [params, setParamsState] = useState<AnalysisParams>(DEFAULT_PARAMS);
  const [status, setStatus] = useState<AnalysisStatus>('idle');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const stopDraw = useRef<(() => void) | null>(null);

  const endDraw = useCallback(() => {
    stopDraw.current?.();
    stopDraw.current = null;
  }, []);
  useEffect(() => endDraw, [endDraw]);

  const execute = useCallback(
    async (op: AnalysisOp, p: AnalysisParams, g: GeoJsonGeometry) => {
      setStatus('running');
      setError(null);
      setLastShape(g);
      try {
        const r = await fetchResult(op, buildInput(op, p, g));
        if (r.geometries.length > 0) run({ kind: 'showGeometries', items: r.geometries, fit: true });
        setResult(r);
        setAnalysisResult(r);
        setStatus('idle');
        setActive(null);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Không chạy được phép phân tích.');
        setStatus('params');
      }
    },
    [fetchResult, run]
  );

  const open = useCallback((op: AnalysisOp) => {
    endDraw();
    setActive(op);
    setError(null);
    setStatus('params');
  }, [endDraw]);

  const setParams = useCallback((patch: Partial<AnalysisParams>) => {
    setParamsState((prev) => ({ ...prev, ...patch }));
  }, []);

  const draw = useCallback(() => {
    if (!active) return;
    endDraw();
    const op = active;
    const p = params;
    setStatus('drawing');
    stopDraw.current = startDraw(drawKindFor(op, p), (g) => {
      endDraw();
      void execute(op, p, g);
    });
  }, [active, params, startDraw, endDraw, execute]);

  const useLastShape = useCallback(async () => {
    if (!active) return;
    const g = getLastShape();
    if (!g || !acceptsShape(active, params, g)) {
      setError('Hình vừa vẽ không dùng được cho phép này — hãy vẽ mới.');
      return;
    }
    await execute(active, params, g);
  }, [active, params, getLastShape, execute]);

  const cancel = useCallback(() => {
    endDraw();
    setActive(null);
    setStatus('idle');
    setError(null);
  }, [endDraw]);

  const clear = useCallback(() => {
    run({ kind: 'clearHighlights' });
    setResult(null);
    setAnalysisResult(null);
  }, [run]);

  const exportCsv = useCallback(() => {
    if (result) downloadCsv(result, `phan-tich-${ANALYSIS_TOOL_LABELS[result.op]}.csv`);
  }, [result]);

  return { active, params, status, result, error, open, setParams, draw, useLastShape, cancel, clear, exportCsv };
}
