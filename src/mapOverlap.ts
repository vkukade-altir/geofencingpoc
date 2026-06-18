/** Pure helpers for map / demo UI (overlap warning). Does not affect geofence registration. */

export type MapStation = {
  id: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
};

export type OverlapPair = {
  idA: string;
  idB: string;
  distanceM: number;
  sumRadiiM: number;
};

export function distanceMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000;
  const p1 = (lat1 * Math.PI) / 180;
  const p2 = (lat2 * Math.PI) / 180;
  const dp = ((lat2 - lat1) * Math.PI) / 180;
  const dl = ((lon2 - lon1) * Math.PI) / 180;
  const x =
    Math.sin(dp / 2) * Math.sin(dp / 2) +
    Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) * Math.sin(dl / 2);
  return 2 * R * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

export function findOverlappingPairs(stations: MapStation[]): OverlapPair[] {
  const out: OverlapPair[] = [];
  for (let i = 0; i < stations.length; i++) {
    for (let j = i + 1; j < stations.length; j++) {
      const a = stations[i];
      const b = stations[j];
      const d = distanceMeters(a.latitude, a.longitude, b.latitude, b.longitude);
      const sumR = a.radiusMeters + b.radiusMeters;
      if (d < sumR) {
        out.push({idA: a.id, idB: b.id, distanceM: d, sumRadiiM: sumR});
      }
    }
  }
  return out;
}
