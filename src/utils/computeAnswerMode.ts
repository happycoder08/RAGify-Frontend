export type AnswerMode = 'NOT_FOUND' | 'EXTRACTED' | 'CITED';

export function computeAnswerMode(input: {
  refused: boolean;
  pipeline_marker?: string | null;
  debug_info?: any;
}): AnswerMode {
  if (input.refused === true) return 'NOT_FOUND';

  const pm = input.pipeline_marker;
  if (typeof pm === 'string' && pm.startsWith('EXTRACTOR_')) return 'EXTRACTED';

  const fallbackPm = input.debug_info?.pipeline_marker;
  if (typeof fallbackPm === 'string' && fallbackPm.startsWith('EXTRACTOR_')) return 'EXTRACTED';

  return 'CITED';
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
