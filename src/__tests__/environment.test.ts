import { describe, expect, it } from 'vitest';
import {
  describeEnvironment,
  detectionGroundingPrompt,
  groupDetections,
  inferSettingFromObjects,
  summarizeEnvironment,
} from '../environment';

function det(className: string, confidence = 0.8, bearingClock = 12) {
  return { className, confidence, bearingClock };
}

function countWords(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

describe('inferSettingFromObjects', () => {
  it('scores indoor domination as indoors', () => {
    expect(inferSettingFromObjects([det('chair'), det('tv'), det('car')])).toBe('indoors');
  });

  it('scores outdoor domination as outdoors', () => {
    expect(inferSettingFromObjects([det('car'), det('bus'), det('chair')])).toBe('outdoors');
  });

  it('returns null on ties or neutral classes', () => {
    expect(inferSettingFromObjects([det('chair'), det('car')])).toBeNull();
    expect(inferSettingFromObjects([det('person')])).toBeNull();
    expect(inferSettingFromObjects([])).toBeNull();
  });
});

describe('groupDetections', () => {
  it('buckets by class and zone, people first', () => {
    const groups = groupDetections([
      det('chair', 0.8, 9),
      det('person', 0.9, 12),
      det('person', 0.7, 12),
      det('car', 0.85, 3),
    ]);
    expect(groups[0].className).toBe('person');
    expect(groups[0].count).toBe(2);
    expect(groups[0].bearingClock).toBe(12);
    expect(groups.map((g) => g.className)).toEqual(['person', 'car', 'chair']);
  });

  it('caps groups and keeps higher-priority classes when trimming', () => {
    // Both static: potted plant (priority 19) outranks tv (priority 21).
    const groups = groupDetections([det('potted plant', 0.6, 10), det('tv', 0.95, 2)], 1);
    expect(groups).toHaveLength(1);
    expect(groups[0].className).toBe('potted plant');
  });
});

describe('summarizeEnvironment (Level 0)', () => {
  it('produces one sentence under 25 words', () => {
    const s = summarizeEnvironment({
      detections: [det('person', 0.9, 12), det('chair', 0.8, 9), det('car', 0.85, 3)],
    });
    expect(s.split('.').filter(Boolean)).toHaveLength(1);
    expect(countWords(s)).toBeLessThanOrEqual(25);
    expect(s).toContain('person in front of you');
    expect(s).toContain('to your left');
  });

  it('pluralizes people correctly and hedges low confidence', () => {
    const s = summarizeEnvironment({ detections: [det('person', 0.55, 9), det('person', 0.6, 9)] });
    expect(s).toContain('what appears to be two people to your left');
  });

  it('caps counts at four, then says several', () => {
    const s = summarizeEnvironment({ detections: [det('chair', 0.8, 12), det('chair', 0.8, 12), det('chair', 0.8, 12), det('chair', 0.8, 12), det('chair', 0.8, 12)] });
    expect(s).toContain('several chairs');
  });

  it('prepends the geocode setting when available', () => {
    const s = summarizeEnvironment({
      detections: [det('car', 0.9, 12)],
      place: { road: 'Via Roma', addresstype: 'road', city: 'Caserta' },
    });
    expect(s.startsWith('You seem to be outdoors on Via Roma, with')).toBe(true);
  });

  it('never stays silent: plain fallback with no objects and no place', () => {
    expect(summarizeEnvironment({ detections: [] })).toBe('No clearly recognizable objects around you right now.');
  });

  it('falls back to setting-only when nothing is recognizable', () => {
    const s = summarizeEnvironment({ detections: [], place: { road: 'Corso Trieste', addresstype: 'road' } });
    expect(s).toBe('You seem to be outdoors on Corso Trieste, and nothing clearly recognizable right now.');
  });
});

describe('describeEnvironment (Level 1)', () => {
  it('orders sentences: setting, moving, periphery — max 5', () => {
    const detections = [
      det('couch', 0.8, 10),
      det('tv', 0.8, 11),
      det('dining table', 0.8, 2),
      det('chair', 0.8, 3),
      det('laptop', 0.8, 9),
      det('dog', 0.85, 12),
      det('person', 0.9, 12),
    ];
    const sentences = describeEnvironment({ detections });
    expect(sentences.length).toBeLessThanOrEqual(5);
    expect(sentences[0]).toMatch(/indoors|building|street/i);
    expect(sentences[1]).toContain('person');
    expect(sentences[sentences.length - 1]).toContain('Also around:');
  });

  it('uses object-based inference when no place context exists', () => {
    const sentences = describeEnvironment({ detections: [det('car'), det('bus')] });
    expect(sentences[0]).toBe("It looks like you're outdoors.");
  });

  it('drops the setting slot silently when unknown', () => {
    const sentences = describeEnvironment({ detections: [det('person')] });
    expect(sentences).toHaveLength(1);
    expect(sentences[0]).toContain('person');
  });

  it('handles a fully empty scene without crashing or going silent', () => {
    expect(describeEnvironment({ detections: [] })).toEqual(['No clearly recognizable objects around you right now.']);
  });
});

describe('detectionGroundingPrompt', () => {
  it('is empty with no detections', () => {
    expect(detectionGroundingPrompt([])).toBe('');
  });

  it('describes measured objects with confidence labels and zones', () => {
    const p = detectionGroundingPrompt([det('person', 0.65, 12), det('chair', 0.5, 9), det('person', 0.9, 12)]);
    expect(p).toContain('On-device object detection');
    expect(p).toContain('2 people in front of you (high confidence)');
    expect(p).toContain('a chair to your left (low confidence)');
  });
});
