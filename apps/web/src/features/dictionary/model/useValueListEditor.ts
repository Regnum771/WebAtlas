import { useState } from 'react';
import { DICTIONARY } from '@webatlas/shared';
import { addValue, patchValue, restoreValue, type RevisedAttribute } from '../api/dictionaryEdit.api';
import type { ValueAddView, ValueListView, ValueRowView } from '../ui/ValueListEditor.view';
import { describeFailure } from './saveFeedback';

interface RowDraft { name?: string; definition?: string; colorHint?: string }
interface AddDraft { code: string; name: string; definition: string }
const EMPTY_ADD: AddDraft = { code: '', name: '', definition: '' };

/** The fields a value row and the add form show errors under; any other refusal is their message. */
const ROW_FIELDS = ['name', 'definition', 'colorHint'] as const;
const ADD_FIELDS = ['code', 'name', 'definition'] as const;

/**
 * The codes the code default (the shared DICTIONARY) lists for an attribute: only those have a
 * default to restore to. The served rows carry no origin, so a staff-added code is told apart this way.
 */
function defaultCodes(layerKey: string, attribute: string): Set<string> {
  const ft = Object.hasOwn(DICTIONARY, layerKey) ? DICTIONARY[layerKey] : undefined;
  return new Set(ft?.attributes.find((a) => a.name === attribute)?.values?.map((v) => v.code) ?? []);
}

interface Feedback { scope: string; message: string | null; errors: Record<string, string> }

/** Body of a value edit: only the fields that differ. A definition cannot be cleared, so an empty one is not sent. */
function rowBody(value: { name: string; definition?: string; colorHint?: string }, draft: RowDraft | undefined) {
  const body: { name?: string; definition?: string; colorHint?: string | null } = {};
  if (!draft) return body;
  if (draft.name !== undefined && draft.name !== value.name) body.name = draft.name;
  if (draft.definition !== undefined && draft.definition !== (value.definition ?? '') && draft.definition.trim() !== '') {
    body.definition = draft.definition;
  }
  if (draft.colorHint !== undefined && draft.colorHint !== (value.colorHint ?? '')) {
    body.colorHint = draft.colorHint.trim() === '' ? null : draft.colorHint.trim();
  }
  return body;
}

/**
 * The listed values of the chosen code attribute: edit name, definition and colour, retire, and (open
 * lists only) add. Every call quotes the PARENT attribute's revision, which each save bumps.
 */
export function useValueListEditor(
  layerKey: string,
  attribute: RevisedAttribute | undefined,
  reload: () => Promise<unknown>,
): ValueListView | null {
  // Drafts are keyed by attribute and code (not revision), so saving one row keeps what is typed in the others;
  // a 409 drops every draft of the attribute.
  const [edits, setEdits] = useState<Record<string, RowDraft>>({});
  const [adds, setAdds] = useState<Record<string, AddDraft>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  if (!attribute || attribute.valueType !== 'code' || !attribute.values) return null;
  const attrKey = `${layerKey}|${attribute.name}`;
  const revision = attribute.revision;
  const scopeOf = (part: string) => `${attrKey}|${part}`;
  const mineOf = (part: string) => (feedback?.scope === scopeOf(part) ? feedback : null);

  async function run(part: string, work: () => Promise<unknown>, onDone: () => void, shown: readonly string[]) {
    setBusy(scopeOf(part));
    setFeedback(null);
    try {
      await work();
      onDone();
      await reload();
    } catch (e) {
      const failure = describeFailure(e, shown);
      setFeedback({ scope: scopeOf(part), message: failure.message, errors: failure.errors });
      if (failure.conflict) {
        setEdits((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !k.startsWith(`${attrKey}|`))));
        await reload();
      }
    } finally {
      setBusy(null);
    }
  }

  const clearError = (part: string, field: string) => setFeedback((prev) => {
    if (!prev || prev.scope !== scopeOf(part) || !(field in prev.errors)) return prev;
    const { [field]: _gone, ...rest } = prev.errors;
    return { ...prev, errors: rest };
  });

  const withDefault = defaultCodes(layerKey, attribute.name);
  const rows: ValueRowView[] = [...attribute.values].sort((a, b) => a.order - b.order).map((v) => {
    const key = scopeOf(v.code);
    const draft = edits[key];
    const body = rowBody(v, draft);
    const mine = mineOf(v.code);
    const save = (patch: Parameters<typeof patchValue>[3], onDone: () => void) => {
      void run(v.code, () => patchValue(layerKey, attribute.name, v.code, patch), onDone, ROW_FIELDS);
    };
    const dropDraft = () => setEdits((prev) => { const { [key]: _gone, ...rest } = prev; return rest; });
    return {
      code: v.code,
      name: draft?.name ?? v.name,
      definition: draft?.definition ?? v.definition ?? '',
      colorHint: draft?.colorHint ?? v.colorHint ?? '',
      retired: v.retired === true,
      dirty: Object.keys(body).length > 0,
      locked: busy !== null,
      saving: busy === key,
      message: mine?.message ?? null,
      errors: mine?.errors ?? {},
      onChange: (field, value) => {
        setEdits((prev) => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
        clearError(v.code, field);
      },
      onSave: () => { if (Object.keys(body).length > 0) save({ expectedRevision: revision, ...body }, dropDraft); },
      // A closed list's codes follow the data structure (the API refuses it too).
      onToggleRetired: attribute.codeList === 'open'
        ? () => save({ expectedRevision: revision, retired: v.retired !== true }, () => {})
        : null,
      // The wording and colour go back to the current code default; what is typed in the row goes too.
      onRestore: withDefault.has(v.code)
        ? () => {
          const fields = [...ROW_FIELDS];
          void run(v.code, () => restoreValue(layerKey, attribute.name, v.code, { expectedRevision: revision, fields }), dropDraft, ROW_FIELDS);
        }
        : null,
    };
  });

  let add: ValueAddView | null = null;
  if (attribute.codeList === 'open') {
    const draft = adds[attrKey] ?? EMPTY_ADD;
    const mine = mineOf('add');
    add = {
      ...draft,
      canAdd: draft.code.trim() !== '' && draft.name.trim() !== '' && busy === null,
      saving: busy === scopeOf('add'),
      message: mine?.message ?? null,
      errors: mine?.errors ?? {},
      onChange: (field, value) => {
        setAdds((prev) => ({ ...prev, [attrKey]: { ...(prev[attrKey] ?? EMPTY_ADD), [field]: value } }));
        clearError('add', field);
      },
      onSubmit: () => {
        const definition = draft.definition.trim();
        const body = { expectedRevision: revision, code: draft.code, name: draft.name, ...(definition ? { definition: draft.definition } : {}) };
        void run('add', () => addValue(layerKey, attribute.name, body), () => setAdds((prev) => ({ ...prev, [attrKey]: EMPTY_ADD })),
          ADD_FIELDS);
      },
    };
  }

  return { attributeLabel: attribute.label, rows, add };
}
