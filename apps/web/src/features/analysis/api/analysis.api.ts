import type { AnalysisOp, AnalysisResult } from '@webatlas/shared';
import { apiRequest } from '../../../shared/api/apiClient';

export function runAnalysis(op: AnalysisOp, input: object): Promise<AnalysisResult> {
  return apiRequest<AnalysisResult>(`/api/analysis/${op}`, { method: 'POST', body: JSON.stringify(input) });
}
