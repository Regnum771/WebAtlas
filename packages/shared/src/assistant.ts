/**
 * The assistant wire contract: everything that crosses POST /api/assistant/messages,
 * plus the reply parser both sides need.
 *
 * Hand-written, no Zod — this module is imported by the browser bundle. The API
 * validates incoming requests with its own Zod schema (modules/assistant/controller.ts);
 * the types here are the shape both sides agree on.
 */
import type { BasemapName, MapCommand } from './map-commands.js';
import type { EditableLayerKey } from './index.js';

/**
 * What the user is currently looking at. Serialized into the latest user turn —
 * never into the top-level system field, which would invalidate the prompt cache
 * on every message. This is what makes "hồ nào lớn nhất ở đây" resolvable.
 */
export interface MapContext {
  /** Viewport bounds in WGS84 degrees: [west, south, east, north]. */
  bbox: [number, number, number, number];
  zoom: number;
  /** layerStateIds currently visible, e.g. ['layer_dams', 'layer_rivers']. */
  visibleLayerStateIds: string[];
  basemap: BasemapName;
  selectedFeature?: { layerKey: EditableLayerKey; featureId: string; name?: string };
}

/**
 * Where one asserted fact came from. One record per tool call, in call order.
 * `datasetVersion` is the label of the active app.dataset_versions row for the
 * layer, so a reader can tell which map the number describes; null when the tool
 * touched no layer (command tools) or the layer has no active version.
 */
export interface Provenance {
  tool: string;
  layerKey: EditableLayerKey | null;
  rowCount: number;
  datasetVersion: string | null;
  /** Present only for the guarded SQL escape hatch, so a reviewer sees what ran. */
  sql?: string;
}

/**
 * A run of reply text and whether it is grounded in tool results or is the
 * model's own knowledge. The spec requires model knowledge to render in a
 * visually distinct labelled callout rather than italics, which the panel
 * cannot do without knowing where the boundaries are.
 */
export type ReplySegment = { kind: 'grounded' | 'knowledge'; text: string };

export interface AssistantRequest {
  /** Client-generated, opaque. Bound to the authenticated user on first use. */
  sessionId: string;
  message: string;
  mapContext: MapContext;
}

export interface AssistantReply {
  segments: ReplySegment[];
  commands: MapCommand[];
  provenance: Provenance[];
}

/** The model is instructed to wrap general knowledge in these. XML-ish tags,
 *  because that is what models emit most reliably, and they are far less likely
 *  to occur in Vietnamese prose than any bracket or punctuation delimiter. */
export const KNOWLEDGE_OPEN_TAG = '<kienthucchung>';
export const KNOWLEDGE_CLOSE_TAG = '</kienthucchung>';

/**
 * Splits a raw reply into grounded and knowledge runs.
 *
 * An unclosed opening tag makes everything after it knowledge, deliberately:
 * a truncated reply must never let unlabelled model knowledge render as though
 * it came from the database.
 */
export function parseReplySegments(text: string): ReplySegment[] {
  const segments: ReplySegment[] = [];
  const push = (kind: ReplySegment['kind'], raw: string) => {
    const trimmed = raw.trim();
    if (trimmed) segments.push({ kind, text: trimmed });
  };

  let rest = text;
  while (rest.length > 0) {
    const open = rest.indexOf(KNOWLEDGE_OPEN_TAG);
    if (open === -1) {
      push('grounded', rest);
      break;
    }
    push('grounded', rest.slice(0, open));
    const afterOpen = rest.slice(open + KNOWLEDGE_OPEN_TAG.length);
    const close = afterOpen.indexOf(KNOWLEDGE_CLOSE_TAG);
    if (close === -1) {
      push('knowledge', afterOpen);
      break;
    }
    push('knowledge', afterOpen.slice(0, close));
    rest = afterOpen.slice(close + KNOWLEDGE_CLOSE_TAG.length);
  }
  return segments;
}
