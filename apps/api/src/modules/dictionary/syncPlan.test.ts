import { describe, it, expect } from 'vitest';
import { DICTIONARY, type DictFeatureType, type Dictionary } from '@webatlas/shared';
import { planSync, type StoredState } from './syncPlan';

const TODAY = '2026-10-24';
const VF = '2026-01-01';
const EDIT = { by: '00000000-0000-4000-8000-0000000000e6', at: '2026-10-20T08:00:00.000Z' };
const EMPTY: StoredState = { featureTypes: [], attributes: [], values: [] };

function damsEntry(): DictFeatureType {
  return {
    key: 'dams',
    kind: 'vector',
    name: 'Đập & Hồ chứa',
    definition: 'Đập và hồ chứa.',
    table: 'water.dams',
    crs: 4326,
    geometryType: 'Point',
    geometryMeaning: 'representativePoint',
    validFrom: VF,
    attributes: [
      {
        name: 'wattage_mw', source: 'column', valueType: 'number', label: 'Công suất', definition: 'Công suất lắp máy.',
        storedUnit: 'MW', displayUnits: ['MW', 'kW'], displayUnit: 'MW', precision: 1, validFrom: VF,
      },
      {
        name: 'status', source: 'column', valueType: 'code', label: 'Trạng thái', definition: 'Trạng thái vận hành.',
        codeList: 'closed',
        values: [{ code: 'binh_thuong', name: 'Bình thường', order: 1 }, { code: 'xa_lu', name: 'Xả lũ', order: 2 }],
        validFrom: VF,
      },
      {
        name: 'lake_type', source: 'column', valueType: 'code', label: 'Loại hồ', definition: 'Loại hồ.',
        codeList: 'open', values: [{ code: 'Ao', name: 'Ao', order: 1 }], validFrom: VF,
      },
      { name: 'note', source: 'extra', valueType: 'text', label: 'Ghi chú', definition: 'Ghi chú thêm.', validFrom: VF },
    ],
  };
}

function riversEntry(): DictFeatureType {
  return {
    key: 'rivers', kind: 'vector', name: 'Sông', definition: 'Sông.', table: 'water.rivers', crs: 4326,
    geometryType: 'MultiLineString', geometryMeaning: 'exact', validFrom: VF,
    attributes: [{ name: 'name', source: 'column', valueType: 'text', label: 'Tên', definition: 'Tên sông.', validFrom: VF }],
  };
}

function demEntry(): DictFeatureType {
  return {
    key: 'dem', kind: 'raster', name: 'Độ cao', definition: 'Mô hình số độ cao.', table: 'raster.dem', crs: 3857,
    geometryMeaning: 'exact', validFrom: VF,
    attributes: [{
      name: '1', source: 'band', valueType: 'number', label: 'Độ cao', definition: 'Độ cao so với mực nước biển.',
      storedUnit: 'm', displayUnits: ['m'], displayUnit: 'm', precision: 0, nodata: -9999, scale: 1, offset: 0, validFrom: VF,
    }],
  };
}

const dictionary = (...entries: DictFeatureType[]): Dictionary => Object.fromEntries(entries.map((e) => [e.key, e]));

/** The store as a first sync of `defaults` leaves it. */
function synced(defaults: Dictionary): StoredState {
  const { inserts } = planSync(defaults, EMPTY, TODAY);
  return structuredClone({ featureTypes: inserts.featureTypes, attributes: inserts.attributes, values: inserts.values });
}

function attribute(state: StoredState, name: string) {
  const row = state.attributes.find((a) => a.featureType === 'dams' && a.name === name);
  if (!row) throw new Error(`no stored attribute ${name}`);
  return row;
}

describe('planSync (spec §2.1)', () => {
  it('an empty store gets every entry inserted', () => {
    const plan = planSync(DICTIONARY, EMPTY, TODAY);
    const all = Object.values(DICTIONARY);
    const attributes = all.flatMap((ft) => ft.attributes);
    expect(plan.inserts.featureTypes.map((f) => f.key)).toEqual(all.map((f) => f.key));
    expect(plan.inserts.attributes).toHaveLength(attributes.length);
    expect(plan.inserts.values).toHaveLength(attributes.flatMap((a) => a.values ?? []).length);
    expect(plan.updates).toEqual([]);
    expect(plan.retires).toEqual([]);
    expect(plan.reverts).toEqual([]);

    // Rows carry the code defaults, the array position as ord, and no edits.
    const own = planSync(dictionary(damsEntry()), EMPTY, TODAY);
    expect(own.inserts.attributes.map((a) => [a.name, a.ord])).toEqual([['wattage_mw', 0], ['status', 1], ['lake_type', 2], ['note', 3]]);
    expect(own.inserts.attributes[3].displayUnits).toEqual([]);
    expect(own.inserts.values.map((v) => [v.attribute, v.code, v.ord, v.retired])).toEqual([
      ['status', 'binh_thuong', 0, false], ['status', 'xa_lu', 1, false], ['lake_type', 'Ao', 0, false],
    ]);
    expect([...own.inserts.featureTypes, ...own.inserts.attributes, ...own.inserts.values].every((r) => Object.keys(r.origin).length === 0)).toBe(true);
  });

  it('an untouched field follows a changed code default', () => {
    const stored = synced(dictionary(damsEntry()));
    const next = damsEntry();
    next.name = 'Đập và hồ chứa thủy điện';
    next.attributes[0].label = 'Công suất lắp máy';
    next.attributes[0].precision = 2;
    next.attributes[1].values![1].name = 'Đang xả lũ';
    const plan = planSync(dictionary(next), stored, TODAY);
    expect(plan.updates).toEqual([
      { featureType: 'dams', set: { name: 'Đập và hồ chứa thủy điện' } },
      { featureType: 'dams', attribute: 'wattage_mw', set: { label: 'Công suất lắp máy', precision: 2 } },
      { featureType: 'dams', attribute: 'status', code: 'xa_lu', set: { name: 'Đang xả lũ' } },
    ]);
    expect(plan.inserts).toEqual({ featureTypes: [], attributes: [], values: [] });
    expect(plan.reverts).toEqual([]);
    expect(plan.retires).toEqual([]);

    // Unchanged code against its own sync: nothing to do.
    const again = planSync(dictionary(damsEntry()), synced(dictionary(damsEntry())), TODAY);
    expect(again).toEqual({ inserts: { featureTypes: [], attributes: [], values: [] }, updates: [], retires: [], reverts: [] });
  });

  it('an edited label is kept', () => {
    const stored = synced(dictionary(damsEntry()));
    const watt = attribute(stored, 'wattage_mw');
    watt.label = 'Công suất (cán bộ sửa)';
    watt.displayUnit = 'kW';
    watt.origin = { label: EDIT, displayUnit: EDIT };
    const next = damsEntry();
    next.attributes[0].label = 'Công suất lắp máy';
    next.attributes[0].definition = 'Công suất lắp máy của nhà máy.';
    const plan = planSync(dictionary(next), stored, TODAY);
    // The edited label and display unit stay; the untouched definition follows the code.
    expect(plan.updates).toEqual([
      { featureType: 'dams', attribute: 'wattage_mw', set: { definition: 'Công suất lắp máy của nhà máy.' } },
    ]);
    expect(plan.reverts).toEqual([]);
  });

  it('a locked field is overwritten even if edited', () => {
    const stored = synced(dictionary(damsEntry()));
    const ft = stored.featureTypes[0];
    ft.table = 'water.dams_old';
    ft.origin = { table: EDIT };
    const watt = attribute(stored, 'wattage_mw');
    watt.storedUnit = 'kW';
    watt.valueType = 'text';
    watt.origin = { valueType: EDIT };
    // valueType is editable only for an extra key.
    const note = attribute(stored, 'note');
    note.valueType = 'number';
    note.origin = { valueType: EDIT };

    const plan = planSync(dictionary(damsEntry()), stored, TODAY);
    expect(plan.updates).toEqual([{ featureType: 'dams', attribute: 'wattage_mw', set: { storedUnit: 'MW' } }]);
    expect(plan.reverts).toEqual([
      expect.objectContaining({ featureType: 'dams', field: 'table', oldValue: 'water.dams_old', newValue: 'water.dams' }),
      expect.objectContaining({ featureType: 'dams', attribute: 'wattage_mw', field: 'valueType', oldValue: 'text', newValue: 'number' }),
    ]);
  });

  it('an edit the code no longer permits is reverted with history', () => {
    const stored = synced(dictionary(damsEntry()));
    const watt = attribute(stored, 'wattage_mw');
    watt.displayUnit = 'kW';
    watt.precision = 7;
    watt.origin = { displayUnit: EDIT, precision: EDIT };
    // A code staff added to the open list.
    stored.values.push({ featureType: 'dams', attribute: 'lake_type', code: 'Đầm', name: 'Đầm', ord: 1, retired: false, origin: { code: EDIT } });

    const next = damsEntry();
    next.attributes[0].displayUnits = ['MW'];
    next.attributes[2].codeList = 'closed';
    const plan = planSync(dictionary(next), stored, TODAY);

    expect(plan.reverts).toEqual([
      { featureType: 'dams', attribute: 'wattage_mw', field: 'displayUnit', oldValue: 'kW', newValue: 'MW' },
      { featureType: 'dams', attribute: 'wattage_mw', field: 'precision', oldValue: 7, newValue: 1 },
      { featureType: 'dams', attribute: 'lake_type', code: 'Đầm', field: 'retired', oldValue: false, newValue: true },
    ]);
    expect(plan.updates).toEqual([
      { featureType: 'dams', attribute: 'wattage_mw', set: { displayUnits: ['MW'] } },
      { featureType: 'dams', attribute: 'lake_type', set: { codeList: 'closed' } },
    ]);
    expect(plan.retires).toEqual([]);

    // A display-unit list edited by staff that drops the shown unit is invalid too.
    const listEdited = synced(dictionary(damsEntry()));
    const w2 = attribute(listEdited, 'wattage_mw');
    w2.displayUnits = ['kW', 'm'];
    w2.origin = { displayUnits: EDIT };
    expect(planSync(dictionary(damsEntry()), listEdited, TODAY).reverts).toEqual([
      expect.objectContaining({ attribute: 'wattage_mw', field: 'displayUnits', oldValue: ['kW', 'm'], newValue: ['MW', 'kW'] }),
    ]);

    // The open list stays open: the staff code is kept.
    expect(planSync(dictionary(damsEntry()), stored, TODAY).reverts.filter((r) => r.code)).toEqual([]);
  });

  it('an entry removed from code is retired once', () => {
    const stored = synced(dictionary(damsEntry(), riversEntry()));
    const next = damsEntry();
    next.attributes = next.attributes.filter((a) => a.name !== 'note');
    next.attributes[1].values = next.attributes[1].values!.slice(0, 1);
    const plan = planSync(dictionary(next), stored, TODAY);
    expect(plan.retires).toEqual([
      { featureType: 'dams', attribute: 'status', code: 'xa_lu', field: 'retired', newValue: true },
      { featureType: 'dams', attribute: 'note', field: 'validTo', newValue: TODAY },
      { featureType: 'rivers', field: 'validTo', newValue: TODAY },
    ]);
    // The children of a retired feature type are left as they are.
    expect(plan.retires.some((r) => r.featureType === 'rivers' && r.attribute)).toBe(false);

    // Once retired, a row is left alone.
    stored.values.find((v) => v.code === 'xa_lu')!.retired = true;
    attribute(stored, 'note').validTo = TODAY;
    stored.featureTypes.find((f) => f.key === 'rivers')!.validTo = TODAY;
    const second = planSync(dictionary(next), stored, '2026-10-25');
    expect(second.retires).toEqual([]);
    expect(second.updates).toEqual([]);

    // An entry that comes back to code is live again.
    const back = planSync(dictionary(damsEntry(), riversEntry()), stored, '2026-10-25');
    expect(back.updates).toStrictEqual([
      { featureType: 'dams', attribute: 'status', code: 'xa_lu', set: { retired: false } },
      { featureType: 'dams', attribute: 'note', set: { validTo: undefined } },
      { featureType: 'rivers', set: { validTo: undefined } },
    ]);
  });

  it('a staff retire on a closed-list code is reverted', () => {
    const stored = synced(dictionary(damsEntry()));
    const closed = stored.values.find((v) => v.attribute === 'status' && v.code === 'binh_thuong')!;
    closed.retired = true;
    closed.origin = { retired: EDIT };
    const open = stored.values.find((v) => v.attribute === 'lake_type' && v.code === 'Ao')!;
    open.retired = true;
    open.origin = { retired: EDIT };
    const plan = planSync(dictionary(damsEntry()), stored, TODAY);
    // Closed: the code decides which codes are in use. Open: staff may retire a code.
    expect(plan.reverts).toEqual([
      { featureType: 'dams', attribute: 'status', code: 'binh_thuong', field: 'retired', oldValue: true, newValue: false },
    ]);
    expect(plan.updates).toEqual([]);
  });

  it('nodata, scale, offset and validFrom are locked', () => {
    const stored = synced(dictionary(demEntry()));
    const ft = stored.featureTypes[0];
    ft.validFrom = '2025-01-01';
    ft.origin = { validFrom: EDIT };
    const band = stored.attributes[0];
    Object.assign(band, { nodata: 0, scale: 0.1, offset: 5, validFrom: '2025-06-01' });
    band.origin = { nodata: EDIT, scale: EDIT, offset: EDIT, validFrom: EDIT };
    const plan = planSync(dictionary(demEntry()), stored, TODAY);
    expect(plan.reverts).toEqual([
      { featureType: 'dem', field: 'validFrom', oldValue: '2025-01-01', newValue: VF },
      { featureType: 'dem', attribute: '1', field: 'nodata', oldValue: 0, newValue: -9999 },
      { featureType: 'dem', attribute: '1', field: 'scale', oldValue: 0.1, newValue: 1 },
      { featureType: 'dem', attribute: '1', field: 'offset', oldValue: 5, newValue: 0 },
      { featureType: 'dem', attribute: '1', field: 'validFrom', oldValue: '2025-06-01', newValue: VF },
    ]);

    // Without an edit, a changed code value is simply taken.
    const next = demEntry();
    next.validFrom = '2026-02-01';
    Object.assign(next.attributes[0], { nodata: -32768, scale: 0.5 });
    expect(planSync(dictionary(next), synced(dictionary(demEntry())), TODAY)).toMatchObject({
      updates: [
        { featureType: 'dem', set: { validFrom: '2026-02-01' } },
        { featureType: 'dem', attribute: '1', set: { nodata: -32768, scale: 0.5 } },
      ],
      reverts: [],
    });
  });

  it('a locked field edited back to the code value only clears its origin', () => {
    const stored = synced(dictionary(damsEntry()));
    stored.featureTypes[0].origin = { table: EDIT };
    attribute(stored, 'wattage_mw').origin = { storedUnit: EDIT };
    const plan = planSync(dictionary(damsEntry()), stored, TODAY);
    expect(plan.reverts).toEqual([]);
    expect(plan.updates).toEqual([
      { featureType: 'dams', set: {}, clearOrigin: ['table'] },
      { featureType: 'dams', attribute: 'wattage_mw', set: {}, clearOrigin: ['storedUnit'] },
    ]);
  });
});
