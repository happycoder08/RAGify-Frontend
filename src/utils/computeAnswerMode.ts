export type AnswerMode = 'NOT_FOUND' | 'EXTRACTED' | 'CITED';

export function computeAnswerMode(input: {
  refused: boolean;
  needs_clarification?: boolean;
  pipeline_marker?: string | null;
  debug_info?: any;
}): AnswerMode {
  if (input.refused === true) return 'NOT_FOUND';
  if (input.needs_clarification === true) return 'NOT_FOUND';  
  
  // Treat clarification as NOT_FOUND for now (until we add a CLARIFY badge)
  const pm = input.pipeline_marker;
  if (pm === 'CLARIFICATION_REQUIRED') return 'NOT_FOUND';
  if (input.debug_info?.pipeline_marker === 'CLARIFICATION_REQUIRED') return 'NOT_FOUND';
  if ((input.debug_info?.needs_clarification ?? false) === true) return 'NOT_FOUND'; // defensive

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

export function tooltipForModeWithContext(
  mode: AnswerMode,
  ctx: { needs_clarification?: boolean; pipeline_marker?: string | null; debug_info?: any }
): string {
  const debugMarker = ctx.debug_info?.pipeline_marker;
  const debugNeedsClarification = ctx.debug_info?.needs_clarification === true;
  if (
    mode === 'NOT_FOUND' &&
    (ctx.needs_clarification === true ||
      ctx.pipeline_marker === 'CLARIFICATION_REQUIRED' ||
      debugMarker === 'CLARIFICATION_REQUIRED' ||
      debugNeedsClarification)
  ) {
    return 'Needs clarification to answer accurately.';
  }
  return tooltipForMode(mode);
}

export default { computeAnswerMode, labelForMode, tooltipForMode, tooltipForModeWithContext };
