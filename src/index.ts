export interface LatLong {
  latitude: number,
  longitude: number
}

export interface LatLongBounds {
  topLeft: LatLong;
  bottomRight: LatLong;
}

function degToRad(deg: number) { return deg/180.0 * Math.PI; }
const EARTH_RADIUS_METERS = 6372800;

export function haversineMeters(pt1: LatLong, pt2: LatLong): number {
  const
    lat1 = degToRad(pt1.latitude),
    lon1 = degToRad(pt1.longitude),
    lat2 = degToRad(pt2.latitude),
    lon2 = degToRad(pt2.longitude),
    dLat = lat2 - lat1,
    dLon = lon2 - lon1;
  const a = Math.sin(dLat / 2) * Math.sin(dLat /2) + Math.sin(dLon / 2) * Math.sin(dLon /2) * Math.cos(lat1) * Math.cos(lat2);
  const c = 2 * Math.asin(Math.sqrt(a));
  return EARTH_RADIUS_METERS * c;
}

function clamp(x: number, [min, max]: [number, number]): number {
  return x > max ? max : x < min ? min : x;
}
// source: https://gis.stackexchange.com/a/127949/29700
export type GoogleZoom =
  | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10
  | 11 | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20;


export function googleZoomLevel(loc: LatLong, metersPerPx: number): GoogleZoom {
  const idealZoom = Math.log2(156543.03392 * Math.cos(loc.latitude * Math.PI / 180) / metersPerPx);
  return clamp(Math.floor(idealZoom), [1, 20]) as GoogleZoom;
}
export function googleZoomMetersPerPx({ latitude }: LatLong, zoom: GoogleZoom): number {
  return 156543.03392 * Math.cos(latitude * Math.PI / 180) / Math.pow(2, zoom);
}

export function chooseZoom(extent: LatLongBounds, clientWidth: number): GoogleZoom {
  const topRight = {
    latitude: extent.topLeft.latitude,
    longitude: extent.bottomRight.longitude,
  };
  // SO we need the extents of the map/grid/ground in lat long
  const metersWidth = haversineMeters(extent.topLeft, topRight);
  // So we need the extents of the map/grid/ground in clientWidth which is px
  const desiredMetersPerPx = metersWidth / clientWidth;
  return googleZoomLevel(topRight, desiredMetersPerPx);
}

export interface WorldCoordinate {
  // as described at https://developers.google.com/maps/documentation/javascript/coordinates
  type: 'WorldCoordinate',
  x: number;
  y: number;
}

const GOOGLE_TILE_SIZE = 256;
export function toWorldCoords({ latitude, longitude }: LatLong): WorldCoordinate {
  const siny = clamp(Math.sin(latitude * Math.PI / 180), [-0.9999, 0.9999]);
  return {
    type: 'WorldCoordinate',
    x: GOOGLE_TILE_SIZE * (0.5 + longitude / 360 ),
    y: GOOGLE_TILE_SIZE * (0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI)),
  };
}

const EXP_2pi = Math.exp(Math.PI * 2);

export function worldToLatLng({ x, y }: WorldCoordinate): LatLong {
  const longitude = (x / GOOGLE_TILE_SIZE - 0.5) * 360;
  const e_to_4pi_y_over_G = Math.exp(4 * Math.PI * y / GOOGLE_TILE_SIZE);
  const siny = (EXP_2pi - e_to_4pi_y_over_G) / (EXP_2pi + e_to_4pi_y_over_G);
  const latitude = Math.asin(siny) * 180 / Math.PI;
  return { latitude, longitude };
}

export interface PixelCoordinate {
  type: 'PixelCoordinate',
  x: number;
  y: number;
  zoom: GoogleZoom;
}
export function worldToPixelCoords({ x, y }: WorldCoordinate, zoom: GoogleZoom): PixelCoordinate {
  // tslint:disable-next-line: no-bitwise
  const zoomFactor = 1 << zoom;
  return {
    type: 'PixelCoordinate',
    x: x * zoomFactor,
    y: y * zoomFactor,
    zoom,
  }
}
export function pixelToWorldCoords({ x, y, zoom }: PixelCoordinate): WorldCoordinate {
// tslint:disable-next-line: no-bitwise
  const zoomFactor = 1 << zoom;
  return {
    type: 'WorldCoordinate',
    x: x / zoomFactor,
    y: y / zoomFactor,
  };
}

export interface TileCoordinate {
  type: 'TileCoordinate';
  x: number;
  y: number;
  zoom: GoogleZoom;
}
export function pixelToTileCoords({ x, y, zoom }: PixelCoordinate): TileCoordinate {
  return {
    type: 'TileCoordinate',
    x: Math.floor(x / GOOGLE_TILE_SIZE),
    y: Math.floor(y / GOOGLE_TILE_SIZE),
    zoom,
  };
}
interface PixelCoordinateBounds {
  topLeft: PixelCoordinate;
  bottomRight: PixelCoordinate;
}
export function tileToPixelCoords({ x, y, zoom }: TileCoordinate): PixelCoordinateBounds {
  const topLeft:PixelCoordinate = {
    type: 'PixelCoordinate',
    x: x * GOOGLE_TILE_SIZE,
    y: y * GOOGLE_TILE_SIZE,
    zoom,
  };
  const bottomRight: PixelCoordinate = {
    type: 'PixelCoordinate',
    x: (x+1) * GOOGLE_TILE_SIZE,
    y: (y+1) * GOOGLE_TILE_SIZE,
    zoom,
  };
  return { topLeft, bottomRight };
}
export function tileCoordinate(loc:LatLong, zoom:GoogleZoom):TileCoordinate {
  return pixelToTileCoords(worldToPixelCoords(toWorldCoords(loc), zoom));
}

export function tileLocation(coords: TileCoordinate): LatLongBounds {
  const pixelBounds = tileToPixelCoords(coords);
  const worldTopLeft = pixelToWorldCoords(pixelBounds.topLeft);
  const worldBottomRight = pixelToWorldCoords(pixelBounds.bottomRight);
  return {
    topLeft: worldToLatLng(worldTopLeft),
    bottomRight: worldToLatLng(worldBottomRight),
  };
}

export function inclusiveRange(min: number, max: number): number[] {
  const range = [min];
  let curr = min;
  while (range[range.length - 1] < max) {
    curr++;
    range.push(curr);
  }
  return range;
}

export function tileCoordinates(extent: LatLongBounds, zoom: GoogleZoom): TileCoordinate[] {
  const tl = tileCoordinate(extent.topLeft, zoom);
  const br = tileCoordinate(extent.bottomRight, zoom);
  const xs = inclusiveRange(tl.x, br.x);
  const ys = inclusiveRange(tl.y, br.y);
  const coords: TileCoordinate[] = [];
  xs.forEach(x => ys.forEach(y => coords.push({
    type: 'TileCoordinate',
    x, y, zoom,
  })));
  return coords;
}

