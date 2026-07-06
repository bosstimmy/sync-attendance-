/**
 * Calculates the geodesic distance between two latitude/longitude coordinates on Earth using the Haversine formula.
 * Returns the exact distance in millimeters.
 */
export function calculateDistanceInMillimeters(
  lat1: number | null | undefined,
  lon1: number | null | undefined,
  lat2: number | null | undefined,
  lon2: number | null | undefined
): number | null {
  if (
    lat1 === null || lat1 === undefined ||
    lon1 === null || lon1 === undefined ||
    lat2 === null || lat2 === undefined ||
    lon2 === null || lon2 === undefined
  ) {
    return null;
  }

  // Convert degrees to radians
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  
  const rLat1 = (lat1 * Math.PI) / 180;
  const rLat2 = (lat2 * Math.PI) / 180;

  // Haversine formula
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(rLat1) * Math.cos(rLat2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  
  const earthRadiusMeters = 6371e3; // 6,371 km
  const distanceMeters = earthRadiusMeters * c;

  // Convert to millimeters (1 meter = 1000 millimeters)
  return Math.round(distanceMeters * 1000);
}

/**
 * Formats a distance in millimeters into a readable display string with meters/kilometers fallback.
 */
export function formatProximity(mm: number | null | undefined): string {
  if (mm === null || mm === undefined) {
    return 'Not calculated';
  }

  if (mm < 1000) {
    return `${mm.toLocaleString()} mm`;
  }

  const meters = mm / 1000;
  if (meters < 1000) {
    return `${mm.toLocaleString()} mm (${meters.toFixed(2)} m)`;
  }

  const km = meters / 1000;
  return `${mm.toLocaleString()} mm (${km.toFixed(2)} km)`;
}

/**
 * Judges the attendee attendance proximity based on the distance in millimeters.
 * Helps determine if they were at the same venue or nearby.
 */
export function getProximityStatus(mm: number | null | undefined): {
  label: string;
  className: string;
  verified: boolean;
} {
  if (mm === null || mm === undefined) {
    return {
      label: 'No Coordinates',
      className: 'bg-gray-100 text-gray-600 border-gray-200',
      verified: false
    };
  }

  // Same spot: within 15 meters (15,000 mm)
  if (mm <= 15000) {
    return {
      label: 'Verified Close',
      className: 'bg-emerald-50 text-emerald-700 border-emerald-100',
      verified: true
    };
  }

  // Same venue/classroom: within 100 meters (100,000 mm)
  if (mm <= 100000) {
    return {
      label: 'Same Venue',
      className: 'bg-indigo-50 text-indigo-700 border-indigo-100',
      verified: true
    };
  }

  // Within 1 kilometer: nearby
  if (mm <= 1000000) {
    return {
      label: 'Nearby Room/Building',
      className: 'bg-amber-50 text-amber-700 border-amber-100',
      verified: false
    };
  }

  // Remote / Out of Range
  return {
    label: 'Remote / Out of Range',
    className: 'bg-red-50 text-red-700 border-red-100',
    verified: false
  };
}
