import { describe, expect, it } from 'vitest';
import { buildPrompt } from '../prompt-builder.js';

describe('buildPrompt', () => {
  it('includes mode-specific instructions for navigation', () => {
    const prompt = buildPrompt('navigation', 'What is ahead?');
    expect(prompt).toContain('mobility assistant');
    expect(prompt).toContain('What is ahead?');
  });

  it('includes the JSON response contract', () => {
    const prompt = buildPrompt('reading', 'Read the sign');
    expect(prompt).toContain('"summary"');
    expect(prompt).toContain('"confidence"');
    expect(prompt).toContain('"shouldStop"');
  });

  it('never claims a path is safe or instructs crossing a road', () => {
    const prompt = buildPrompt('navigation', 'test');
    expect(prompt).toContain('Never claim a path is definitely safe');
    expect(prompt).toContain('Never instruct the user to cross a road');
  });

  it('throws for emergency mode', () => {
    expect(() => buildPrompt('emergency', 'help')).toThrow();
  });

  it('falls back to a default request note when prompt is empty', () => {
    const prompt = buildPrompt('assistant', '   ');
    expect(prompt).toContain('no additional request');
  });
});
