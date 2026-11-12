import { useEffect, useMemo, useState } from 'react';
import { COUNTRY_UNIT, type EditableLayerKey, type Permission, type UnitNode, type UnitTree } from '@webatlas/shared';
import { useSession } from '../../../entities/session/model/session.store';
import { useCan } from '../../../entities/session/model/useCan';
import { useUnitTree } from '../../../entities/session/model/useUnitTree';
import { suggestManagingUnit } from '../api/features.api';
import type { GeoJSONGeometry } from '../../map/model/mapEditing';

export const SUGGEST_DEBOUNCE_MS = 300;
export const SUGGEST_FAILED_HINT = 'Không gợi ý được đơn vị — hãy chọn.';

interface Args {
  layerKey: EditableLayerKey;
  /** create: a new feature (POST, feature.create); edit: an existing one (PUT, feature.update). */
  mode: 'create' | 'edit';
  geometry: GeoJSONGeometry | null;
  /** The feature's current unit code on edit; '' on create or when it has none. */
  initial: string;
}

export interface ManagingUnitFieldState {
  /** The unit shown in the field ('' for none). May be an out-of-scope suggestion: see `error`. */
  value: string;
  setValue: (code: string) => void;
  /**
   * Units the user may assign: the operation's right (feature.create on create, feature.update
   * on edit) and submission.review there (admin: the whole tree).
   */
  options: UnitNode[];
  allowed: (code: string) => boolean;
  tree: UnitTree | null;
  suggestion: string | null;
  error: string | null;
  hint: string | null;
  /** Set when the feature's current unit is outside the user's reach: shown as text, not editable. */
  readOnlyText: string | null;
  /**
   * Edit only: the user may not save this feature at all, because its current unit fails
   * feature.update AND submission.review (a missing unit counts as VN, as the API reads it).
   * Also true for a non-admin until the unit tree has loaded. Never true on create.
   */
  locked: boolean;
  /** The code the form may send, or null when nothing (valid) is chosen. */
  submittable: string | null;
}

/**
 * State of the "Đơn vị chủ quản" field. On create the unit is suggested from the geometry
 * (debounced, stale answers dropped) until the user picks one; on edit it starts at the
 * feature's current unit. The API enforces jurisdiction regardless.
 */
export function useManagingUnitField({ layerKey: _layerKey, mode, geometry, initial }: Args): ManagingUnitFieldState {
  const tree = useUnitTree();
  const can = useCan();
  const { currentUser } = useSession();
  const opPermission: Permission = mode === 'create' ? 'feature.create' : 'feature.update';

  const options = useMemo(() => {
    if (!tree) return [];
    return [...tree.values()].filter((n) => can(opPermission, n.code) && can('submission.review', n.code));
    // `can` is a fresh closure each render; only the tree and the signed-in user change its answers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree, currentUser, opPermission]);
  const optionCodes = useMemo(() => new Set(options.map((n) => n.code)), [options]);
  const allowed = useMemo(() => (code: string) => optionCodes.has(code), [optionCodes]);

  const [chosen, setChosen] = useState<string | null>(initial || null);
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [suggestFailed, setSuggestFailed] = useState(false);

  const suggests = !initial;
  useEffect(() => {
    if (!suggests) return;
    // A new geometry makes the previous suggestion stale at once: a save inside the debounce
    // window must not send the old unit (it then sends none and the API suggests from the shape).
    setSuggestion(null);
    setSuggestFailed(false);
    if (!geometry) return;
    // Set by cleanup: a newer geometry (or unmount) makes this request's answer stale.
    let stale = false;
    const timer = setTimeout(() => {
      suggestManagingUnit(geometry).then(
        (unit) => { if (!stale) { setSuggestion(unit); setSuggestFailed(false); } },
        () => { if (!stale) { setSuggestion(null); setSuggestFailed(true); } },
      );
    }, SUGGEST_DEBOUNCE_MS);
    return () => { stale = true; clearTimeout(timer); };
  }, [geometry, suggests]);

  const value = chosen ?? suggestion ?? '';
  const nameOf = (code: string) => tree?.get(code)?.name ?? code;
  const loaded = tree !== null;

  // The unit the API checks an edit against: the feature's own, or VN when it has none.
  const current = initial || COUNTRY_UNIT;
  const locked = mode === 'edit' && !(can('feature.update', current) && can('submission.review', current));
  const readOnlyText = locked && loaded ? `${nameOf(current)} — ngoài phạm vi của anh/chị` : null;
  const outOfScope = !initial && chosen === null && suggestion !== null && loaded && !optionCodes.has(suggestion);
  const error = outOfScope ? `${nameOf(suggestion!)} nằm ngoài phạm vi của anh/chị — hãy chọn đơn vị khác.` : null;
  const hint = suggestFailed && chosen === null ? SUGGEST_FAILED_HINT : null;
  const submittable = value && !error && !locked ? value : null;

  return {
    value, setValue: setChosen, options, allowed, tree, suggestion, error, hint, readOnlyText, locked, submittable,
  };
}
