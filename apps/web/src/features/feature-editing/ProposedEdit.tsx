import { LAYER_ATTRIBUTE_MAP, type FeatureEditProposal } from '@webatlas/shared';
import { RequireRole } from '../auth/ui/RequireRole';
import { useMapEditing } from '../map/model/mapEditing';
import { closeProposal, notifyProposalSaved, useProposal } from '../../entities/proposal/proposal.store';
import { useProposedEditPresenter } from './model/useProposedEditPresenter';
import { ProposedEditWizardView } from './ui/ProposedEditWizard.view';

function ProposedEditDialog({ proposal }: { proposal: FeatureEditProposal }) {
  const { refreshLayer } = useMapEditing();
  const label = proposal.name ?? 'đối tượng';
  const p = useProposedEditPresenter(proposal, {
    onSaved: (count) => {
      refreshLayer(LAYER_ATTRIBUTE_MAP[proposal.layerKey].layerStateId);
      notifyProposalSaved(`Đã cập nhật ${count} trường của "${label}".`);
      closeProposal();
    },
  });
  return (
    <ProposedEditWizardView
      title={label}
      columns={p.columns} labels={p.labels} values={p.values}
      isChanged={p.isChanged} previous={p.previous}
      sourceDocument={p.sourceDocument} sourceProvider={p.sourceProvider}
      canSave={p.canSave} saving={p.saving} error={p.error}
      onField={p.setField} onSourceDocument={p.setSourceDocument} onSourceProvider={p.setSourceProvider}
      onSubmit={p.submit} onCancel={closeProposal}
    />
  );
}

// UX gate ONLY: PUT enforces admin. A proposal opened for a non-admin renders nothing.
export default function ProposedEdit() {
  const proposal = useProposal();
  if (!proposal) return null;
  return (
    <RequireRole role="admin">
      {/* key remounts per proposal so the presenter re-seeds its initial values */}
      <ProposedEditDialog key={`${proposal.featureId}:${JSON.stringify(proposal.proposed)}`} proposal={proposal} />
    </RequireRole>
  );
}
