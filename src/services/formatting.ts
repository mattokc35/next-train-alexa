import type { TrainArrival } from '../services/types';

/**
 * Formats a list of upcoming arrivals (already sorted soonest-first) into a
 * spoken response for GetNextTrainIntent.
 */
export function formatNextTrainSpeech(
  stationDisplayName: string,
  arrivals: TrainArrival[],
  count = 3,
): string {
  if (arrivals.length === 0) {
    return `Sorry, I couldn't find any upcoming trains for ${stationDisplayName} right now.`;
  }

  const upcoming = arrivals.slice(0, count);
  const arrivalPhrases = upcoming.map((arrival) => {
    const minutesPhrase =
      arrival.minutesAway <= 1 ? 'arriving now' : `in ${arrival.minutesAway} minutes`;
    return `${minutesPhrase} to ${arrival.destination}`;
  });

  let speech = `At ${stationDisplayName}, the next trains are ${joinWithAnd(arrivalPhrases)}.`;

  const [next] = upcoming;
  if (next.status === 'delayed' || next.status === 'alert') {
    speech += ` Note: ${next.statusDetail ?? 'this line may be delayed.'}`;
  }

  return speech;
}

/** Joins phrases with commas and a trailing "and", e.g. "a, b, and c". */
function joinWithAnd(phrases: string[]): string {
  if (phrases.length === 1) {
    return phrases[0];
  }
  if (phrases.length === 2) {
    return `${phrases[0]}, and ${phrases[1]}`;
  }
  return `${phrases.slice(0, -1).join(', ')}, and ${phrases[phrases.length - 1]}`;
}

/**
 * Formats delay/alert status for GetDelayStatusIntent.
 */
export function formatDelayStatusSpeech(
  stationDisplayName: string,
  arrivals: TrainArrival[],
): string {
  if (arrivals.length === 0) {
    return `Sorry, I couldn't find current status information for ${stationDisplayName} right now.`;
  }

  const withAlerts = arrivals.filter((a) => a.status === 'delayed' || a.status === 'alert');
  if (withAlerts.length === 0) {
    return `Good news — service at ${stationDisplayName} looks to be running on time, no delays reported.`;
  }

  const lines = Array.from(new Set(withAlerts.map((a) => a.lineName))).join(', ');
  const detail = withAlerts[0].statusDetail;
  return `Heads up — there may be delays affecting the ${lines} at ${stationDisplayName}.${
    detail ? ` ${detail}` : ' Consider checking for detour options.'
  }`;
}
