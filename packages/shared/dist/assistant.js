/** The model is instructed to wrap general knowledge in these. XML-ish tags,
 *  because that is what models emit most reliably, and they are far less likely
 *  to occur in Vietnamese prose than any bracket or punctuation delimiter. */
export const KNOWLEDGE_OPEN_TAG = '<kienthucchung>';
export const KNOWLEDGE_CLOSE_TAG = '</kienthucchung>';
/**
 * Splits a raw reply into grounded and knowledge runs.
 *
 * An unclosed opening tag makes everything after it knowledge, deliberately:
 * a truncated reply must never let unlabelled model knowledge render as though
 * it came from the database.
 */
export function parseReplySegments(text) {
    const segments = [];
    const push = (kind, raw) => {
        const trimmed = raw.trim();
        if (trimmed)
            segments.push({ kind, text: trimmed });
    };
    let rest = text;
    while (rest.length > 0) {
        const open = rest.indexOf(KNOWLEDGE_OPEN_TAG);
        if (open === -1) {
            push('grounded', rest);
            break;
        }
        push('grounded', rest.slice(0, open));
        const afterOpen = rest.slice(open + KNOWLEDGE_OPEN_TAG.length);
        const close = afterOpen.indexOf(KNOWLEDGE_CLOSE_TAG);
        if (close === -1) {
            push('knowledge', afterOpen);
            break;
        }
        push('knowledge', afterOpen.slice(0, close));
        rest = afterOpen.slice(close + KNOWLEDGE_CLOSE_TAG.length);
    }
    return segments;
}
