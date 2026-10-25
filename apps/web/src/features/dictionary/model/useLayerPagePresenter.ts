import { useMemo } from 'react';
import { commonConversions, formatDisplayNumber, unit, type DictAttribute, type GeometryMeaning } from '@webatlas/shared';
import { API_BASE_URL } from '../../../shared/config';
import { useDictionary } from './useDictionary';
import { isCurrent } from './isCurrent';
import { TYPE_LABEL } from './labels';
import type { LayerPageData, LayerPageRow } from '../ui/LayerPage.view';

const MEANING_LABEL: Record<GeometryMeaning, string> = {
  exact: 'chính xác',
  approximate: 'gần đúng',
  representativePoint: 'điểm đại diện',
};

function geometryLabel(type: string | undefined): string | undefined {
  if (!type) return undefined;
  if (type.includes('Polygon')) return 'Đa giác';
  if (type.includes('Line')) return 'Đường';
  return 'Điểm';
}

function symbol(code: string): string {
  return unit(code).symbol;
}

/** A conversion factor in vi-VN notation; the precision of six keeps small factors such as 0,001 km³. */
function formatFactor(factor: number): string {
  return formatDisplayNumber(
    { name: '', source: 'column', valueType: 'number', label: '', definition: '', validFrom: '', precision: 6 },
    factor,
  );
}

function toRow(attribute: DictAttribute): LayerPageRow {
  const stored = attribute.storedUnit;
  const display = attribute.displayUnit ?? stored;
  let unitText: string | undefined;
  if (display) {
    unitText = stored && stored !== display ? `${symbol(stored)} → ${symbol(display)}` : symbol(display);
  }
  const conversions = display
    ? commonConversions(display).map((c) => `1 ${symbol(display)} = ${formatFactor(c.factor)} ${symbol(c.to)}`)
    : [];
  return {
    name: attribute.name,
    label: attribute.label,
    definition: attribute.definition,
    typeLabel: TYPE_LABEL[attribute.valueType],
    unitText: unitText || undefined,
    conversions,
    values: attribute.valueType === 'code' && attribute.values
      ? [...attribute.values]
          .sort((a, b) => a.order - b.order)
          .map((v) => ({ code: v.code, name: v.name, retired: !!v.retired }))
      : undefined,
    cfStandardName: attribute.cfStandardName,
    retired: !isCurrent(attribute.validTo),
  };
}

/** The /du-lieu/:key page: one layer's header, full attribute table and template links. */
export function useLayerPagePresenter(key: string): { page: LayerPageData | null } {
  const dictionary = useDictionary();
  return useMemo(() => {
    const f = Object.hasOwn(dictionary, key) ? dictionary[key] : undefined;
    if (!f) return { page: null };
    const retiredFrom = isCurrent(f.validTo) ? undefined : f.validTo;
    const base = `${API_BASE_URL}/api/dictionary/${encodeURIComponent(f.key)}`;
    return {
      page: {
        name: f.name,
        definition: f.definition,
        kindLabel: f.kind === 'vector' ? 'Lớp vectơ' : 'Lớp ảnh',
        geometryText: f.kind === 'vector'
          ? [geometryLabel(f.geometryType), MEANING_LABEL[f.geometryMeaning]].filter(Boolean).join(' — ')
          : undefined,
        epsg: `EPSG:${f.crs}`,
        validFrom: f.validFrom,
        retiredFrom,
        rows: f.attributes.map(toRow),
        templates: f.kind === 'vector' && !retiredFrom
          ? { gpkg: `${base}/template.gpkg`, csv: `${base}/template.csv` }
          : undefined,
      },
    };
  }, [dictionary, key]);
}
