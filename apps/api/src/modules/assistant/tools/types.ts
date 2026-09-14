import type { Pool } from 'pg';
import type { MapCommand, MapContext, Provenance } from '@webatlas/shared';
// BetaRunnableTool is used (but not re-exported) by helpers/beta/zod's
// betaZodTool return type; import it from its actual source instead.
import type { BetaRunnableTool } from '@anthropic-ai/sdk/lib/tools/BetaRunnableTool';

/**
 * Everything a tool may touch, handed to it per request. Tools are factories
 * over this rather than free functions reading globals, so a test constructs a
 * context and asserts exactly what the tool collected.
 */
export interface ToolContext {
  pool: Pool;
  /** What the user is looking at — resolves "ở đây", "vùng đang xem". */
  mapContext: MapContext;
  /** Command tools push validated MapCommands here, in call order. */
  collect: (command: MapCommand) => void;
  /** Data tools push one record per call here, in call order. */
  provenance: (record: Provenance) => void;
}

export type ToolFactory = (ctx: ToolContext) => BetaRunnableTool;
