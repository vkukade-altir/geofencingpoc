type Activity = {
  confidence: number;
  type: string;
};

type Battery = {
  is_charging: boolean;
  level: number;
};

type Coords = {
  accuracy: number;
  age: number;
  altitude: number;
  altitude_accuracy: number;
  ellipsoidal_altitude: number;
  heading: number;
  heading_accuracy: number;
  latitude: number;
  longitude: number;
  speed: number;
  speed_accuracy: number;
};

type Geofence = {
  action: string;
  identifier: string;
  timestamp: string;
};

type Location = {
  activity: Activity;
  age: number;
  battery: Battery;
  coords: Coords;
  event: string;
  extras: Record<string, unknown>;
  geofence: Geofence;
  is_moving: boolean;
  odometer: number;
  timestamp: string;
  uuid: string;
};

export type GeofenceAction = {
  action: string;
  identifier: string;
  location: Location;
  timestamp: string;
};
