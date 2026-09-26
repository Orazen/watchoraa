import { matchDeterministicCommand } from './voice/deterministicCommands';
import { HELP_MESSAGE } from './voice/voiceTypes';

/**
 * The landing-page demo brain.
 *
 * It routes the visitor's phrase through the SAME deterministic command router
 * the signed-in app uses (matchDeterministicCommand), then answers with either
 * the app's REAL spoken string (where one exists and can be quoted without a
 * live account — the emergency gate, the clock, the help message) or an honest
 * first-person description of what the app would do.
 *
 * Nothing here is faked: no invented quotes, no pretend network calls, no
 * performed safety actions. Safety commands stop at the confirmation gate and
 * say so — that gate IS the product.
 */

export type DemoReply = {
  /** What watchora would say out loud. */
  say: string;
  /** One sentence of honest context about what really happens in the app. */
  note: string;
};

export type DemoExchange = {
  transcript: string;
  intent: string;
  requiresConfirmation: boolean;
  reply: DemoReply;
};

function describe(intent: string, say: string, note: string): DemoReply {
  return { say, note };
}

function replyFor(intent: string, params: Record<string, unknown>, now: Date): DemoReply {
  switch (intent) {
    case 'help':
      // The app's real help message, byte for byte.
      return { say: HELP_MESSAGE, note: 'This is the actual help message the app speaks — not a marketing summary.' };
    case 'what_time_is_it': {
      // Same local-clock answer as the app: no network, no account.
      const spokenTime = now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      return { say: `It is ${spokenTime}.`, note: 'Answered instantly on the device — no network, no sign-in.' };
    }
    case 'emergency':
      return {
        say: 'Emergency requested. Say confirm to share your location with trusted contacts, or cancel.',
        note: 'The demo stops at the gate, exactly like the app: nothing is sent until you say confirm, and the SOS screen adds its own 5-second cancel window.',
      };
    case 'cancel_emergency':
      return {
        say: 'Cancelling emergency. Say confirm to cancel, or cancel to abort.',
        note: 'Raising and standing down an emergency are both confirmation-gated.',
      };
    case 'i_am_lost':
      // The demo has no journey, so quote the app's real no-journey answer.
      return {
        say: 'You do not have an active journey. Say emergency if you need help now.',
        note: 'On an active Safe Journey this marks you lost instead and notifies your trusted contact.',
      };
    case 'where_am_i':
      return describe(
        intent,
        'In the app I would speak your location — GPS first, falling back to a city-level fix when you are indoors.',
        'Location is never faked: it says which kind of fix it used.',
      );
    case 'describe_surroundings':
      return describe(
        intent,
        'In the app I would turn on the camera and read the objects detected on your device — instantly, offline.',
        'This path never touches the network: the object detection runs on the phone.',
      );
    case 'describe_scene':
      return describe(
        intent,
        'In the app the camera takes one frame and the AI describes what is directly ahead — obstacles first, then the safe path.',
        'Honest confidence: when the model is unsure, the warning says so out loud.',
      );
    case 'read_text':
      return describe(
        intent,
        'In the app on-device OCR reads the sign, label, or document aloud — low-confidence reads go to the cloud instead of guessing.',
        'Works offline for most text; the cloud read is the fallback, not the default.',
      );
    case 'identify_currency':
      return describe(
        intent,
        'In the app the camera identifies the banknote and speaks it — and tells you when the lighting makes it unsure rather than guessing between two similar notes.',
        'Money is a never-guess category: an unsure answer is spoken as unsure.',
      );
    case 'identify_color':
      return describe(
        intent,
        'In the app the camera names the colour of whatever you point at.',
        'Useful for dressing, cooking, and checking indicator lights.',
      );
    case 'read_expiry':
      return describe(
        intent,
        'In the app I would read the expiry date off the packaging out loud.',
        'One of the daily-living commands: money, colours, dates, barcodes.',
      );
    case 'scan_product':
      return describe(
        intent,
        'In the app the barcode scanner looks the product up and speaks what it finds.',
        'Runs against a real product database, with a checksum on the code first.',
      );
    case 'find_thing': {
      const name = typeof params.name === 'string' && params.name ? params.name : 'your thing';
      return describe(
        intent,
        `In the app I would help you find ${name} — you teach it where things are, then ask by voice.`,
        'Find-my-things: "teach this as my keys", then "find my keys".',
      );
    }
    case 'teach_thing':
      return describe(
        intent,
        'In the app I would remember this object under the name you gave it.',
        'Taught objects are found later with "find my …".',
      );
    case 'start_safe_journey': {
      const dest = typeof params.destination === 'string' && params.destination ? params.destination : '';
      return describe(
        intent,
        dest
          ? `In the app this starts a Safe Journey to ${dest}: periodic check-ins, and missing one alerts your trusted contact.`
          : 'In the app this starts a Safe Journey: periodic check-ins, and missing one alerts your trusted contact.',
        'Journeys have real spoken check-ins, a lost-mode, and an honest end.',
      );
    }
    case 'start_navigation': {
      const dest = typeof params.destination === 'string' && params.destination ? params.destination : 'your destination';
      return describe(
        intent,
        `In the app this starts guided navigation toward ${dest}, with spoken hazard reports along the way.`,
        'Hazards are reported with clock-face bearings, not distances that cannot be measured.',
      );
    }
    case 'stop_safe_journey':
      return describe(intent, 'In the app this ends the active journey and says so plainly — it never claims to end a journey that failed to end.', '');
    case 'check_journey':
      return describe(intent, 'In the app this reports your active journey and the time of your last check-in.', '');
    case 'i_am_safe':
      return describe(intent, 'In the app this records that you are safe and tells your trusted contacts.', '');
    case 'i_arrived':
      return describe(intent, 'In the app this marks the journey arrived and lets your trusted contact know.', '');
    case 'send_location':
      return describe(
        intent,
        'In the app this shares your current location with your trusted contacts — confirmation-gated, like every safety action.',
        '',
      );
    case 'who_acknowledged':
      return describe(
        intent,
        'In the app this answers who acknowledged your emergency, from the live emergency session.',
        'A status question never re-arms the alarm.',
      );
    case 'reports_near':
      return describe(
        intent,
        'In the app this reads community hazard reports near you, with bearings.',
        'Reports are spatial ("to the left"), and exact coordinates are never exposed to other users.',
      );
    case 'list_places':
      return describe(intent, 'In the app this speaks your saved places with how far away they are.', '');
    case 'save_place':
      return describe(intent, 'In the app this saves a place so you can find your way back to it later.', '');
    case 'repeat':
      return describe(intent, 'In the app I would repeat the last thing I said.', '');
    case 'stop_speech':
      return describe(intent, 'In the app I would stop speaking immediately.', 'Speech can always be interrupted — the app never talks over you.');
    case 'speak_slower':
    case 'speak_faster':
      return describe(intent, 'In the app the speech rate changes right away.', 'Rate, voice, and verbosity are real settings.');
    case 'more_detail':
    case 'shorter_answer':
    case 'follow_up':
      return describe(intent, 'In the app this reshapes the last answer — more detail, shorter, or a follow-up question.', '');
    case 'permission_status':
      return describe(intent, 'In the app this reports which permissions are granted and which are missing, out loud.', '');
    case 'open_tab':
    case 'change_setting':
    case 'set_coach_mode':
    case 'shopping':
      return describe(intent, 'In the app this changes the screen or setting you asked for.', '');
    default:
      return describe(
        intent,
        `Understood: ${intent.replace(/_/g, ' ')}.`,
        'This capability runs inside the signed-in app; the public demo only routes the command.',
      );
  }
}

/**
 * Route one demo phrase. Returns null when the deterministic router does not
 * match — the demo does not pretend to be an AI; it says so instead.
 */
export function runDemoCommand(transcript: string, now: Date = new Date()): DemoExchange | null {
  const intent = matchDeterministicCommand(transcript);
  if (!intent) return null;
  return {
    transcript,
    intent: intent.intent,
    requiresConfirmation: intent.requiresConfirmation,
    reply: replyFor(intent.intent, intent.parameters, now),
  };
}

/** The honest answer when nothing matched — plus what to try instead. */
export const DEMO_UNKNOWN_REPLY: DemoReply = {
  say: 'I did not recognise that as a command. Try: what time is it, read this, what money is this, or emergency.',
  note: 'Inside the app, phrases like this go to the AI parser, which also answers general questions.',
};

/** Example chips — every transcript here is verified against the real router. */
export const DEMO_SUGGESTIONS: Array<{ label: string; transcript: string }> = [
  { label: 'What can you do', transcript: 'what can you do' },
  { label: 'What time is it', transcript: 'what time is it' },
  { label: 'What is around me', transcript: 'what is around me' },
  { label: "I'm lost", transcript: "i'm lost" },
  { label: 'What money is this', transcript: 'what money is this' },
  { label: 'Read this', transcript: 'read this' },
  { label: 'Find my keys', transcript: 'find my keys' },
  { label: 'Emergency', transcript: 'emergency' },
];
