import type { PersonaId } from '../../../entities/persona/persona';

const COPY: Partial<Record<PersonaId, { heading: string; body: string }>> = {
  governance: { heading: 'Governance workspace', body: 'Oversight, filtering, comparison and reporting tools are coming soon.' },
  research: { heading: 'Research workspace', body: 'Attribute query, analysis, export and saved views are coming soon.' },
};

export function WorkspacePlaceholder({ persona }: { persona: PersonaId }) {
  const copy = COPY[persona] ?? { heading: 'Workspace', body: 'Coming soon.' };
  return (
    <div className="workspace-placeholder">
      <p className="workspace-placeholder-heading">{copy.heading}</p>
      <p className="workspace-placeholder-body">{copy.body}</p>
    </div>
  );
}
