import { describe, it, expect } from 'vitest';
import { computeAnswerMode, labelForMode, tooltipForMode } from '../../utils/computeAnswerMode';

describe('computeAnswerMode', () => {
  it('returns NOT_FOUND when refused is true', () => {
    const mode = computeAnswerMode({ refused: true });
    expect(mode).toBe('NOT_FOUND');
    expect(labelForMode(mode)).toBe('NOT FOUND');
    expect(tooltipForMode(mode)).toBe('Model refused or no supported evidence.');
  });

  it('returns EXTRACTED when pipeline_marker startsWith EXTRACTOR_', () => {
    const mode = computeAnswerMode({ refused: false, pipeline_marker: 'EXTRACTOR_XYZ' });
    expect(mode).toBe('EXTRACTED');
    expect(labelForMode(mode)).toBe('EXTRACTED');
    expect(tooltipForMode(mode)).toBe('Answer synthesized from extracted evidence.');
  });

  it('returns EXTRACTED when debug_info.pipeline_marker indicates extractor', () => {
    const mode = computeAnswerMode({ refused: false, debug_info: { pipeline_marker: 'EXTRACTOR_ABC' } });
    expect(mode).toBe('EXTRACTED');
  });

  it('returns EXTRACTED when debug_info.extractor_used === true', () => {
    const mode = computeAnswerMode({ refused: false, debug_info: { extractor_used: true } });
    expect(mode).toBe('EXTRACTED');
  });

  it('returns CITED by default', () => {
    const mode = computeAnswerMode({ refused: false });
    expect(mode).toBe('CITED');
    expect(labelForMode(mode)).toBe('CITED');
    expect(tooltipForMode(mode)).toBe('Answer supported by citations/evidence.');
  });
});
