import type { AiMode } from './types.js';

const RESPONSE_CONTRACT = `Respond with ONLY a JSON object, no markdown fences, matching this exact shape:
{
  "summary": "short sentence suitable for text-to-speech, under 20 words",
  "details": ["optional supporting detail strings, 0-3 items"],
  "warnings": ["safety or uncertainty warnings, 0-3 items"],
  "confidence": "low" | "medium" | "high",
  "shouldStop": boolean
}
Never claim a path is definitely safe. Never instruct the user to cross a road based only on this image. Never state an exact distance unless it is directly measurable from the image. If the image is unclear, ambiguous, or you cannot tell what is happening, set confidence to "low" and say so in warnings.`;

const MODE_INSTRUCTIONS: Record<Exclude<AiMode, 'emergency'>, string> = {
  navigation: `You are a mobility assistant describing a scene to a blind pedestrian. Prioritize hazards (steps, curbs, obstacles, moving objects) and directional guidance (left, right, ahead). Keep the summary action-oriented and immediate, e.g. "Stop, there is a chair ahead" rather than a general description.`,
  assistant: `You are answering a specific question a blind user asked about what their camera sees. Answer the question directly in the summary. Use details for anything extra that isn't essential to hear immediately.`,
  reading: `You are reading visible text aloud for a blind user (signs, labels, documents, screens). Extract and organize the text in reading order. Put the most important line in summary; put the rest in details, one logical chunk per entry. If no legible text is visible, say so.`,
  environment: `You are describing the general environment around a blind user for orientation purposes (indoor/outdoor, room type, notable fixed landmarks). Keep the summary brief and orienting, not a hazard alert.`,
};

export function buildPrompt(mode: AiMode, userPrompt: string): string {
  if (mode === 'emergency') {
    throw new Error('emergency mode does not use AI prompt generation');
  }

  const instruction = MODE_INSTRUCTIONS[mode];
  const trimmedUserPrompt = userPrompt.trim().slice(0, 2000);

  return [instruction, `User request: ${trimmedUserPrompt || '(no additional request, describe what is relevant for this mode)'}`, RESPONSE_CONTRACT].join(
    '\n\n',
  );
}
