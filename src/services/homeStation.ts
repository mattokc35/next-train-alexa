import type { AttributesManager } from 'ask-sdk-core';

/**
 * Shape of the per-user persistent attributes stored via
 * ask-sdk-dynamodb-persistence-adapter (keyed by Alexa userId). Currently
 * just the user's saved "home base" station, stored by its canonical
 * display name (e.g. "Grove Street") so it can be passed straight back into
 * StationRegistry.findStation() the same way a spoken STATION slot would be.
 */
export interface HomeStationAttributes {
  homeStationDisplayName?: string;
}

/** Reads the user's saved home base station display name, if any. */
export async function getHomeStationDisplayName(
  attributesManager: AttributesManager,
): Promise<string | undefined> {
  const attributes =
    (await attributesManager.getPersistentAttributes()) as HomeStationAttributes | undefined;
  return attributes?.homeStationDisplayName;
}

/** Saves (and persists) the user's home base station display name. */
export async function setHomeStationDisplayName(
  attributesManager: AttributesManager,
  displayName: string,
): Promise<void> {
  const attributes =
    ((await attributesManager.getPersistentAttributes()) as HomeStationAttributes | undefined) ??
    {};
  attributesManager.setPersistentAttributes({
    ...attributes,
    homeStationDisplayName: displayName,
  });
  await attributesManager.savePersistentAttributes();
}
