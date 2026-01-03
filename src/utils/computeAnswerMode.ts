export type AnswerMode = 'NOT_FOUND' | 'EXTRACTED' | 'CITED';

export function computeAnswerMode(input: { refused: boolean; pipeline_marker?: string | null; debug_info?: any }): AnswerMode {
  try {
    if (input.refused === true) return 'NOT_FOUND';

    const pm = input.pipeline_marker ?? (input.debug_info && input.debug_info.pipeline_marker) ?? null;
    if (typeof pm === 'string' && pm.startsWith('EXTRACTOR_')) return 'EXTRACTED';

    if (input.debug_info && input.debug_info.extractor_used === true) return 'EXTRACTED';

    return 'CITED';
  } catch {
    return 'CITED';
  }
}

export function labelForMode(mode: AnswerMode): 'NOT FOUND' | 'EXTRACTED' | 'CITED' {
  switch (mode) {
    case 'NOT_FOUND':
      return 'NOT FOUND';
    case 'EXTRACTED':
      return 'EXTRACTED';
    case 'CITED':
    default:
      return 'CITED';
  }
}

export function tooltipForMode(mode: AnswerMode): string {
  switch (mode) {
    case 'NOT_FOUND':
      return 'Model refused or no supported evidence.';
    case 'EXTRACTED':
      return 'Answer synthesized from extracted evidence.';
    case 'CITED':
    default:
      return 'Answer supported by citations/evidence.';
  }
}

export default { computeAnswerMode, labelForMode, tooltipForMode };
