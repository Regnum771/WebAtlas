import { DictionaryListView, useDictionaryListPresenter } from '../../features/dictionary';

/** /du-lieu: the data dictionary's layer list, over the live map. */
export default function DuLieuRoute() {
  const list = useDictionaryListPresenter();
  return (
    <div className="quan-ly-route">
      <DictionaryListView {...list} />
    </div>
  );
}
