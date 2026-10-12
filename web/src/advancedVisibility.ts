import type { AppLocation } from './navigation.ts';
// Protect bookmarks, restored locations and disconnects as well as tab visibility.
export function visibleLocation(location: AppLocation, advancedConnected: boolean): AppLocation {
  return !advancedConnected && (location.view === 'menu' || location.view === 'calibration')
    ? { view: 'layouts' } : location;
}
