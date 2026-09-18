import { useNavigate } from 'react-router-dom';
import { findCrs } from '@webatlas/shared';
import { useMapContext } from '../../app/providers/MapProvider';
import Legend from '../../features/legend';
import { useAnalysisResult } from '../../features/analysis/model/analysisResult.store';
import { ANALYSIS_TOOL_LABELS } from '../../features/analysis/model/tools';
import { formatScale, scaleAtZoom } from '../../features/map/model/zoomScale';
import { useCrsPreference } from '../../features/map/model/crsPreference';
import { usePrintPage } from './model/usePrintPage';
import { PrintPageView } from './ui/PrintPage.view';

export default function PrintRoute() {
  const navigate = useNavigate();
  const { map, basemap, layersState } = useMapContext();
  const analysis = useAnalysisResult();
  const [crsId] = useCrsPreference();
  const p = usePrintPage({
    map,
    basemap,
    visibleLayerIds: layersState.filter((l) => l.visible).map((l) => l.id),
    crsLabel: findCrs(crsId).alias,
  });
  const zoom = map?.getView().getZoom() ?? 0;

  return (
    <PrintPageView
      title={p.title} onTitle={p.setTitle} paper={p.paper} onPaper={p.setPaper}
      toggles={p.toggles} onToggle={p.toggle}
      imageUrl={p.imageUrl} capturing={p.capturing} exportError={p.exportError}
      attributions={[...p.attributions, ...(analysis?.attribution ? [analysis.attribution] : [])]}
      scaleText={formatScale(scaleAtZoom(zoom))} crsLabel={p.crsLabel} date={p.date}
      legend={<Legend />}
      analysis={analysis ? (
        <section>
          <h2>{ANALYSIS_TOOL_LABELS[analysis.op]}</h2>
          <table className="analysis-summary"><tbody>
            {Object.entries(analysis.summary).map(([k, v]) => <tr key={k}><th scope="row">{k}</th><td>{String(v)}</td></tr>)}
          </tbody></table>
          {analysis.rows && analysis.rows.length > 0 && (
            <table className="print-rows"><thead><tr><th>Tên</th><th>Lớp</th><th>Khoảng cách (km)</th></tr></thead><tbody>
              {analysis.rows.map((r, i) => (
                <tr key={r.featureId ?? i}><td>{r.name ?? '(không tên)'}</td><td>{r.layerKey ?? ''}</td><td>{r.distanceKm ?? ''}</td></tr>
              ))}
            </tbody></table>
          )}
        </section>
      ) : null}
      onDownload={p.downloadPng} onPrint={p.print} onClose={() => navigate('/')}
    />
  );
}
