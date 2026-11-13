import { UseAsRoiButton } from '../roi/ui/UseAsRoiButton';
import { roiOfSearchHit } from '../roi/model/candidates';
import { useCommandPalette } from './model/useCommandPalette';
import { CommandPaletteView } from './ui/CommandPalette.view';

/** The header's search field and the Ctrl K command palette behind it; also owns the / shortcut. */
export default function CommandPalette() {
  const p = useCommandPalette();
  return (
    <CommandPaletteView
      open={p.open}
      onOpen={p.openPalette}
      onClose={p.close}
      query={p.query}
      onQuery={p.setQuery}
      places={p.places}
      layers={p.layers}
      coordinate={p.coordinate}
      commands={p.commands}
      onPlace={p.onPlace}
      onLayer={p.onLayer}
      onCoordinate={p.onCoordinate}
      onCommand={p.onCommand}
      renderPlaceAction={(hit) => <UseAsRoiButton roi={roiOfSearchHit(hit)} label={hit.name} />}
    />
  );
}
