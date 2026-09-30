import { useCallback, useState } from 'react';
import type { AnalysisResult, MapCommand } from '@webatlas/shared';
import { ApiError } from '../../../shared/api/apiClient';
import { getRoiState, setRoiHint, type RoiState } from '../../roi/model/roi.store';
import { toolAvailability, type RoiTool } from '../../roi/model/toolAvailability';
import { runAnalysis } from '../api/analysis.api';
import { ANALYSIS_TOOL_LABELS, DEFAULT_PARAMS, buildInput, type AnalysisParams } from './tools';
import { downloadCsv } from './csv';
import { setAnalysisResult } from './analysisResult.store';

export interface UseAnalysisDeps {
  run: (cmd: MapCommand) => unknown;
  fetchResult?: typeof runAnalysis;
  getRoi?: () => Pick<RoiState, 'roi' | 'resolved'>;
  /** Where a disabled tool's reason goes when it is pressed (U-2): the chip. */
  onUnavailable?: (reason: string) => void;
}

export type AnalysisStatus = 'idle' | 'params' | 'running';

export function useAnalysis({
  run, fetchResult = runAnalysis, getRoi = getRoiState, onUnavailable = setRoiHint,
}: UseAnalysisDeps) {
  const [active, setActive] = useState<RoiTool | null>(null);
  const [params, setParamsState] = useState<AnalysisParams>(DEFAULT_PARAMS);
  const [status, setStatus] = useState<AnalysisStatus>('idle');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [resultRoiLabel, setResultRoiLabel] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback((tool: RoiTool) => {
    const availability = toolAvailability(tool, getRoi().resolved);
    if (!availability.enabled) {
      onUnavailable(availability.reason);
      return;
    }
    setActive(tool);
    setError(null);
    setStatus('params');
  }, [getRoi, onUnavailable]);

  const setParams = useCallback((patch: Partial<AnalysisParams>) => {
    setParamsState((prev) => ({ ...prev, ...patch }));
  }, []);

  const execute = useCallback(async () => {
    const { roi, resolved } = getRoi();
    if (!active || !roi || !resolved) return;
    // The ROI may have changed since the panel opened.
    const availability = toolAvailability(active, resolved);
    if (!availability.enabled) {
      setError(availability.reason);
      return;
    }
    setStatus('running');
    setError(null);
    try {
      const r = await fetchResult(active, buildInput(active, params, roi));
      if (r.geometries.length > 0) run({ kind: 'showGeometries', items: r.geometries, fit: true });
      setResult(r);
      setResultRoiLabel(resolved.label);
      setAnalysisResult(r);
      setStatus('idle');
      setActive(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Không chạy được phép phân tích.');
      setStatus('params');
    }
  }, [active, params, getRoi, fetchResult, run]);

  const cancel = useCallback(() => {
    setActive(null);
    setStatus('idle');
    setError(null);
  }, []);

  const clear = useCallback(() => {
    run({ kind: 'clearHighlights' });
    setResult(null);
    setResultRoiLabel(null);
    setAnalysisResult(null);
  }, [run]);

  const exportCsv = useCallback(() => {
    if (result) downloadCsv(result, `phan-tich-${ANALYSIS_TOOL_LABELS[result.op]}.csv`);
  }, [result]);

  return { active, params, status, result, resultRoiLabel, error, open, setParams, execute, cancel, clear, exportCsv };
}
