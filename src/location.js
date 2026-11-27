// GPS position (browser geolocation) and distance helpers.

let watchId = null;
let latest = null;
let problem = null;

/** Starts or stops following the position. Safe to call repeatedly. */
export function trackLocation(on) {
  if (!("geolocation" in navigator)) {
    problem = "This device has no location support.";
    return;
  }
  if (on && watchId === null) {
    problem = null;
    watchId = navigator.geolocation.watchPosition(
      (p) => {
        problem = null;
        latest = {
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          accuracy: Math.round(p.coords.accuracy),
          at: p.timestamp,
        };
      },
      (err) => {
        problem = err.code === 1 ? "Location permission was refused." : "Location is not available right now.";
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
    );
  } else if (!on && watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
    latest = null;
  }
}

export const currentLocation = () => latest;
export const locationProblem = () => problem;

/** Great-circle distance in metres. */
export function distanceMeters(a, b) {
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

export function formatDistance(m) {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(1)} km`;
}

/** Opened only when the user clicks it. */
export const mapLink = ({ lat, lng }) =>
  `https://www.openstreetmap.org/?mlat=${lat.toFixed(5)}&mlon=${lng.toFixed(5)}#map=17/${lat.toFixed(5)}/${lng.toFixed(5)}`;
