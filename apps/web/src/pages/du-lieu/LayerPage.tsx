import { useParams } from 'react-router-dom';
import { LayerPageView, useLayerPagePresenter } from '../../features/dictionary';

/** /du-lieu/:key: one layer's attribute table, over the live map. */
export default function LayerPage() {
  const { key = '' } = useParams();
  const { page } = useLayerPagePresenter(key);
  return (
    <div className="quan-ly-route">
      <LayerPageView page={page} />
    </div>
  );
}
