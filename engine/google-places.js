/**
 * BW² — Google Places & Maps Integration
 * ────────────────────────────────────────
 * Provides Google Places Autocomplete, Geocoding, and Maps
 * as primary geolocation services with Nominatim fallback.
 *
 * APIs required (Google Cloud Console):
 *   - Maps JavaScript API
 *   - Places API (New)
 *   - Geocoding API
 */

let _apiKey = null;
let _mapsLoaded = false;
let _mapsLoadPromise = null;

/* ══════════════════════════════════════════
   CONFIGURATION
   ══════════════════════════════════════════ */

/**
 * Set the Google API key. Call once at app init.
 */
export function setGoogleApiKey(key) {
  _apiKey = key;
}

export function getGoogleApiKey() {
  return _apiKey;
}

/* ══════════════════════════════════════════
   DYNAMIC SCRIPT LOADER
   ══════════════════════════════════════════ */

/**
 * Dynamically load the Google Maps JavaScript API with Places library.
 * Returns a promise that resolves when the API is ready.
 */
export function loadGoogleMaps() {
  if (_mapsLoaded && window.google?.maps) return Promise.resolve();
  if (_mapsLoadPromise) return _mapsLoadPromise;

  if (!_apiKey) {
    console.warn('[GooglePlaces] No API key set. Call setGoogleApiKey() first.');
    return Promise.reject(new Error('Google API key not configured'));
  }

  _mapsLoadPromise = new Promise((resolve, reject) => {
    // Check if already loaded by another path
    if (window.google?.maps?.places) {
      _mapsLoaded = true;
      resolve();
      return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${_apiKey}&libraries=places&language=es&region=MX&loading=async`;
    script.async = true;
    script.defer = true;

    script.onload = () => {
      _mapsLoaded = true;
      console.log('[GooglePlaces] Maps JS API loaded ✓');
      resolve();
    };

    script.onerror = () => {
      _mapsLoadPromise = null;
      reject(new Error('Failed to load Google Maps JS API'));
    };

    document.head.appendChild(script);
  });

  return _mapsLoadPromise;
}

/**
 * Check if Google Maps is available.
 */
export function isGoogleMapsLoaded() {
  return _mapsLoaded && !!window.google?.maps;
}

/* ══════════════════════════════════════════
   GOOGLE PLACES AUTOCOMPLETE
   ══════════════════════════════════════════ */

/**
 * Attach Google Places Autocomplete to an input element.
 *
 * @param {HTMLInputElement} inputEl - The text input to bind
 * @param {object} opts
 * @param {function} opts.onSelect - Callback when a place is selected: (place) => void
 *   place = { lat, lng, displayName, municipio, estado, colonia, cp, placeId, formattedAddress }
 * @param {string[]} opts.types - Place types filter (default: ['geocode', 'establishment'])
 * @returns {google.maps.places.Autocomplete|null}
 */
export async function attachPlacesAutocomplete(inputEl, opts = {}) {
  if (!inputEl) return null;

  try {
    await loadGoogleMaps();
  } catch (e) {
    console.warn('[GooglePlaces] Could not load Maps API for autocomplete:', e.message);
    return null;
  }

  const autocomplete = new google.maps.places.Autocomplete(inputEl, {
    types: opts.types || ['geocode', 'establishment'],
    componentRestrictions: { country: 'mx' },
    fields: ['place_id', 'formatted_address', 'geometry', 'address_components', 'name', 'types'],
  });

  autocomplete.addListener('place_changed', () => {
    const place = autocomplete.getPlace();
    if (!place.geometry) {
      console.warn('[GooglePlaces] Place selected but no geometry');
      return;
    }

    const parsed = parseGooglePlace(place);
    if (opts.onSelect) opts.onSelect(parsed);
  });

  // Style the pac-container to match our dark/light theme
  _injectPacStyles();

  return autocomplete;
}

/**
 * Parse a Google Place result into our standard format.
 */
function parseGooglePlace(place) {
  const loc = place.geometry.location;
  const comps = place.address_components || [];

  const getComp = (type) => {
    const c = comps.find(c => c.types.includes(type));
    return c?.long_name || null;
  };

  const getCompShort = (type) => {
    const c = comps.find(c => c.types.includes(type));
    return c?.short_name || null;
  };

  return {
    lat: loc.lat(),
    lng: loc.lng(),
    displayName: place.formatted_address || place.name || '',
    name: place.name || '',
    municipio: getComp('locality') || getComp('administrative_area_level_2') || getComp('sublocality_level_1') || null,
    estado: getComp('administrative_area_level_1') || null,
    colonia: getComp('sublocality_level_1') || getComp('neighborhood') || getComp('sublocality') || null,
    cp: getComp('postal_code') || null,
    placeId: place.place_id || null,
    formattedAddress: place.formatted_address || '',
    source: 'Google Places',
    confidence: 'alta',
    importance: 0.9,
    type: place.types?.[0] || null,
    category: 'google',
  };
}

/* ══════════════════════════════════════════
   GOOGLE GEOCODING
   ══════════════════════════════════════════ */

/**
 * Geocode an address string using Google Geocoding API.
 * Returns the same format as location-engine's geocodeAddress.
 *
 * @param {string} query - Address to geocode
 * @param {boolean} returnMultiple - Return array of results
 * @returns {object|object[]}
 */
export async function googleGeocode(query, returnMultiple = false) {
  await loadGoogleMaps();

  const geocoder = new google.maps.Geocoder();

  return new Promise((resolve, reject) => {
    geocoder.geocode(
      {
        address: query,
        region: 'mx',
        componentRestrictions: { country: 'MX' },
      },
      (results, status) => {
        if (status !== 'OK' || !results?.length) {
          reject(new Error(`Google Geocoding: ${status}`));
          return;
        }

        const parseResult = (r) => {
          const loc = r.geometry.location;
          const comps = r.address_components || [];
          const getComp = (type) => comps.find(c => c.types.includes(type))?.long_name || null;

          return {
            lat: loc.lat(),
            lng: loc.lng(),
            displayName: r.formatted_address,
            municipio: getComp('locality') || getComp('administrative_area_level_2') || null,
            estado: getComp('administrative_area_level_1') || null,
            colonia: getComp('sublocality_level_1') || getComp('neighborhood') || null,
            cp: getComp('postal_code') || null,
            source: 'Google Geocoding',
            confidence: r.geometry.location_type === 'ROOFTOP' ? 'alta' :
                        r.geometry.location_type === 'RANGE_INTERPOLATED' ? 'alta' :
                        r.geometry.location_type === 'GEOMETRIC_CENTER' ? 'media' : 'baja',
            importance: r.geometry.location_type === 'ROOFTOP' ? 0.95 : 0.7,
            type: r.types?.[0] || null,
            category: 'google',
            placeId: r.place_id || null,
          };
        };

        if (returnMultiple) resolve(results.map(parseResult));
        else resolve(parseResult(results[0]));
      }
    );
  });
}

/* ══════════════════════════════════════════
   GOOGLE MAP CREATION
   ══════════════════════════════════════════ */

/**
 * Create an interactive Google Map in a container.
 *
 * @param {HTMLElement} container - DOM element to render map into
 * @param {number} lat - Center latitude
 * @param {number} lng - Center longitude
 * @param {object} opts
 * @param {number} opts.zoom - Zoom level (default 15)
 * @param {object[]} opts.markers - Array of { lat, lng, title, icon, color }
 * @param {number[]} opts.circles - Array of radius values in meters to draw
 * @returns {google.maps.Map}
 */
export async function createGoogleMap(container, lat, lng, opts = {}) {
  await loadGoogleMaps();

  const map = new google.maps.Map(container, {
    center: { lat, lng },
    zoom: opts.zoom || 15,
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: true,
    zoomControl: true,
    styles: _getMapStyles(),
  });

  // Center marker
  new google.maps.Marker({
    position: { lat, lng },
    map,
    title: 'Ubicación seleccionada',
    icon: {
      path: google.maps.SymbolPath.CIRCLE,
      scale: 10,
      fillColor: '#6B7A2E',
      fillOpacity: 1,
      strokeColor: '#fff',
      strokeWeight: 3,
    },
    zIndex: 100,
  });

  // Radius circles
  if (opts.circles) {
    const circleColors = ['rgba(107,122,46,0.12)', 'rgba(107,122,46,0.07)', 'rgba(107,122,46,0.04)'];
    opts.circles.forEach((radius, i) => {
      new google.maps.Circle({
        map,
        center: { lat, lng },
        radius,
        fillColor: circleColors[i] || circleColors[2],
        fillOpacity: 0.3,
        strokeColor: '#6B7A2E',
        strokeOpacity: 0.4,
        strokeWeight: 1,
      });
    });
  }

  // POI markers
  if (opts.markers) {
    const MARKER_ICONS = {
      pharmacy:   { color: '#ef4444', symbol: '💊' },
      health:     { color: '#3b82f6', symbol: '🏥' },
      school:     { color: '#f59e0b', symbol: '🎓' },
      church:     { color: '#8b5cf6', symbol: '⛪' },
      market:     { color: '#ea580c', symbol: '🛒' },
      transport:  { color: '#06b6d4', symbol: '🚌' },
      bank:       { color: '#10b981', symbol: '🏦' },
      restaurant: { color: '#ec4899', symbol: '🍽️' },
      default:    { color: '#6b7280', symbol: '📍' },
    };

    opts.markers.forEach(m => {
      const iconCfg = MARKER_ICONS[m.type] || MARKER_ICONS.default;
      new google.maps.Marker({
        position: { lat: m.lat, lng: m.lng },
        map,
        title: m.title || m.name || '',
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 6,
          fillColor: m.color || iconCfg.color,
          fillOpacity: 0.85,
          strokeColor: '#fff',
          strokeWeight: 1.5,
        },
      });
    });
  }

  return map;
}

/**
 * Build POI markers from a location study's classified data.
 */
export function buildStudyMarkers(study) {
  if (!study?.classified) return [];
  const c = study.classified;
  const markers = [];

  const add = (arr, type) => {
    (arr || []).forEach(item => {
      if (item.lat && item.lng) {
        markers.push({ lat: item.lat, lng: item.lng, name: item.name, type, distance: item.distance });
      }
    });
  };

  add(c.farmacias, 'pharmacy');
  add(c.salud, 'health');
  add(c.escuelas, 'school');
  add(c.iglesias, 'church');
  add(c.mercados, 'market');
  add(c.transporte, 'transport');
  add(c.bancos, 'bank');
  add(c.restaurantes, 'restaurant');

  return markers;
}

/* ══════════════════════════════════════════
   MAP STYLING (premium dark/light)
   ══════════════════════════════════════════ */

function _getMapStyles() {
  // Clean, muted style matching dashboard aesthetics
  return [
    { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#c9d5e5' }] },
    { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#f5f5f0' }] },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#e8e0d0' }] },
    { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#efe9de' }] },
    { featureType: 'road.local', elementType: 'geometry', stylers: [{ color: '#f7f3ed' }] },
    { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#ccc' }] },
  ];
}

/* ══════════════════════════════════════════
   PAC-CONTAINER STYLING
   ══════════════════════════════════════════ */

let _pacStylesInjected = false;
function _injectPacStyles() {
  if (_pacStylesInjected) return;
  _pacStylesInjected = true;

  const style = document.createElement('style');
  style.textContent = `
    /* Google Places Autocomplete dropdown styling */
    .pac-container {
      font-family: 'Inter', -apple-system, sans-serif !important;
      border-radius: 12px !important;
      border: 1px solid var(--border, #e5e7eb) !important;
      box-shadow: 0 8px 32px rgba(0,0,0,0.12) !important;
      margin-top: 4px !important;
      overflow: hidden !important;
      z-index: 10000 !important;
      background: var(--bg-card, #fff) !important;
    }
    .pac-item {
      padding: 8px 14px !important;
      font-size: 0.8rem !important;
      border-bottom: 1px solid var(--border, #f3f4f6) !important;
      cursor: pointer !important;
      transition: background 0.15s !important;
      color: var(--text-1, #333) !important;
      line-height: 1.4 !important;
    }
    .pac-item:hover, .pac-item-selected {
      background: var(--accent-soft, #f0fdf4) !important;
    }
    .pac-item-query {
      font-weight: 600 !important;
      color: var(--text-1, #1f2937) !important;
      font-size: 0.8rem !important;
    }
    .pac-matched {
      font-weight: 700 !important;
      color: var(--accent, #6B7A2E) !important;
    }
    .pac-icon {
      display: none !important;
    }
    .pac-logo::after {
      display: none !important;
    }
  `;
  document.head.appendChild(style);
}
