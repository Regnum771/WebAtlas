import type { AssistantReply, MapContext } from '@webatlas/shared';
import { apiRequest } from '../../../shared/api/apiClient';

export interface AssistantRequestBody {
  sessionId: string;
  message: string;
  mapContext: MapContext;
}

export function postAssistantMessage(body: AssistantRequestBody): Promise<AssistantReply> {
  return apiRequest<AssistantReply>('/api/assistant/messages', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}
