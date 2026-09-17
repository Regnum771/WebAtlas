// Xem zoomToRegion.ts: 'zod/v4' là bắt buộc do betaZodTool.
import { z } from 'zod/v4';
import { betaZodTool } from '@anthropic-ai/sdk/helpers/beta/zod';
import {
  EDITABLE_LAYER_KEYS,
  MAX_SOURCE_DOCUMENT_LENGTH,
  MAX_SOURCE_PROVIDER_LENGTH,
  editableColumns,
  isMapCommand,
  type FeatureEditProposal,
} from '@webatlas/shared';
import type { ToolFactory } from '../types';
import { LAYER_LABELS, activeVersionLabel, isFeatureId, resolveFeature } from '../data/helpers';

/**
 * Turns "cập nhật công suất Sông Hinh thành 72 MW" into a PROPOSAL, never a write.
 * The browser opens the admin wizard prefilled with it; the admin confirms and the
 * save goes through PUT /api/layers/:key/features/:id, which enforces admin-only.
 * Registered only for admins (registry.ts).
 */
export const proposeFeatureUpdateTool: ToolFactory = (ctx) =>
  betaZodTool({
    name: 'propose_feature_update',
    description:
      'Open an update form, prefilled with proposed attribute values, for the administrator to review and save. Does NOT write anything. featureId must come from a data tool. changes maps DB column names (e.g. wattage_mw, status, name) to new values as text. Pass sourceDocument (decision/report name or number) and sourceProvider (who supplied the figures) when the user mentions them.',
    inputSchema: z.object({
      layerKey: z.enum(EDITABLE_LAYER_KEYS),
      featureId: z.string(),
      changes: z.record(z.string(), z.string().nullable()),
      sourceDocument: z.string().max(MAX_SOURCE_DOCUMENT_LENGTH).optional(),
      sourceProvider: z.string().max(MAX_SOURCE_PROVIDER_LENGTH).optional(),
    }),
    run: async (input) => {
      const allowed = editableColumns(input.layerKey);
      const unknown = Object.keys(input.changes).filter((c) => !allowed.includes(c));
      if (unknown.length > 0) {
        return `Không cập nhật được cột ${unknown.join(', ')} của lớp ${LAYER_LABELS[input.layerKey]}. Các cột hợp lệ: ${allowed.join(', ')}.`;
      }
      if (Object.keys(input.changes).length === 0) return 'Chưa có giá trị nào cần cập nhật.';

      const [feature, datasetVersion] = await Promise.all([
        isFeatureId(input.featureId) ? resolveFeature(ctx.pool, input.layerKey, input.featureId) : Promise.resolve(null),
        activeVersionLabel(ctx.pool, input.layerKey),
      ]);
      ctx.provenance({
        tool: 'propose_feature_update',
        layerKey: input.layerKey,
        rowCount: feature ? 1 : 0,
        datasetVersion,
      });
      if (!feature) return 'Không có dữ liệu: không tìm thấy đối tượng cần cập nhật.';

      const current: Record<string, string | null> = {};
      for (const c of allowed) current[c] = feature.properties[c] ?? null;
      const proposed: Record<string, string | null> = {};
      for (const [c, v] of Object.entries(input.changes)) {
        if ((current[c] ?? null) !== v) proposed[c] = v;
      }
      if (Object.keys(proposed).length === 0) {
        return 'Giá trị đề xuất trùng với dữ liệu hiện tại — không có gì để cập nhật.';
      }

      const sourceDocument = input.sourceDocument?.trim() || undefined;
      const sourceProvider = input.sourceProvider?.trim() || undefined;
      const proposal: FeatureEditProposal = {
        kind: 'proposeFeatureEdit',
        layerKey: input.layerKey,
        featureId: feature.featureId,
        ...(feature.name ? { name: feature.name } : {}),
        current,
        proposed,
        ...(sourceDocument ? { sourceDocument } : {}),
        ...(sourceProvider ? { sourceProvider } : {}),
      };
      if (!isMapCommand(proposal)) return 'Không tạo được đề xuất cập nhật hợp lệ.';

      const highlight = {
        kind: 'showGeometries' as const,
        fit: true,
        items: [{
          geometry: feature.geometry,
          role: 'highlight' as const,
          ...(feature.name ? { label: feature.name } : {}),
          layerKey: input.layerKey,
          featureId: feature.featureId,
        }],
      };
      if (isMapCommand(highlight)) ctx.collect(highlight);
      ctx.collect(proposal);

      const missing = [
        sourceDocument ? null : 'tài liệu nguồn',
        sourceProvider ? null : 'người cung cấp',
      ].filter(Boolean);
      const label = feature.name ?? 'đối tượng';
      return (
        `Đã mở biểu mẫu đề xuất cập nhật cho "${label}" (${Object.keys(proposed).length} trường). ` +
        'Chưa có gì được ghi: quản trị viên cần kiểm tra và bấm Lưu.' +
        (missing.length > 0 ? ` Còn thiếu: ${missing.join(' và ')} — hãy hỏi người dùng.` : '')
      );
    },
  });
