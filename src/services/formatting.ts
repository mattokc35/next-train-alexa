import type { TrainArrival } from '../services/types';

/**
 * Formats a list of upcoming arrivals (already sorted soonest-first) into a
 * spoken response for GetNextTrainIntent.
 */
export function formatNextTrainSpeech(
  stationDisplayName: string,
  arrivals: TrainArrival[],
): string {
  if (arrivals.length === 0) {
    return `Sorry, I couldn't find any upcoming trains for ${stationDisplayName} right now.`;
  }

  const [next, ...rest] = arrivals;
  const minutesPhrase =
    next.minutesAway <= 1 ? 'is arriving now' : `is in ${next.minutesAway} minutes`;
  let speech = `The next ${next.lineName} train at ${stationDisplayName} ${minutesPhrase}, heading to ${next.destination}.`;

  if (next.status === 'delayed' || next.status === 'alert') {
    speech += ` Note: ${next.statusDetail ?? 'this line may be delayed.'}`;
  }

  if (rest.length > 0) {
    const following = rest[0];
    speech += ` After that, another ${following.lineName} train is in ${following.minutesAway} minutes.`;
  }

  return speech;
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
