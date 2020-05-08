import {
    LatLong, toWorldCoords, worldToLatLng,
    WorldCoordinate, worldToPixelCoords, GoogleZoom,
    pixelToWorldCoords, PixelCoordinate, TileCoordinate,
    tileToPixelCoords, pixelToTileCoords, tileCoordinates, LatLongBounds, chooseZoom, googleZoomMetersPerPx, googleZoomLevel, haversineMeters
  } from './index';
  import { check, property, gen, Generator, CheckOptions } from 'testcheck';

  function assert(condition: boolean, message?: string): void {
    if (!condition) {
      throw new Error(message || 'Assertion failed');
    }
  }

  function nearlyEqual(a: number, b: number, epsilon = 0.000001) {
    return Math.abs(a - b) <= epsilon;
  }

  function assertNearlyEqual(a: number, b: number, epsilon = 0.000001) {
    assert(nearlyEqual(a, b, epsilon), `expected ${a} to be nearly equal to ${b}`);
  }

  const genLatLng = gen.object({
    latitude: gen.numberWithin(-89, 89),
    longitude: gen.numberWithin(-179, 179),
  }) as Generator<LatLong>;

  const genWorldCoord = gen.object({
    x: gen.numberWithin(1, 255),
    y: gen.numberWithin(3, 253), // be careful around the poles
    // we're willing to lose some generality in order to avoid
    // unpleasant projection issues.
    type: gen.return('WorldCoordinate'),
  }) as Generator<WorldCoordinate>;

  const genZoomLevel = gen.intWithin(1, 20) as Generator<GoogleZoom>;

  const genPixelCoords = (gen.object({
    wc: genWorldCoord,
    zoom: genZoomLevel,
  }) as Generator<{ wc: WorldCoordinate, zoom: GoogleZoom }>)
  .then(({ wc, zoom }): PixelCoordinate => ({
    type: 'PixelCoordinate',
    x: wc.x * Math.pow(2, zoom),
    y: wc.y * Math.pow(2, zoom),
    zoom,
  }));

  const genTileCoord = gen.object({
    zoom: genZoomLevel,
    unwrappedX: gen.intWithin(0, 2**20 - 1),
    unwrappedY: gen.intWithin(0, 2**20 - 1),
  }).then(({ zoom, unwrappedX, unwrappedY }) => {
    // bring x, y into allowable range based on choice of zoom.
    const maxIx = zoom ** 20 - 1;
    const x = unwrappedX % maxIx;
    const y = unwrappedY % maxIx;
    return {
      type: 'TileCoordinate',
      x, y, zoom,
    };
  }) as Generator<TileCoordinate>;

  // We're on an ancient version of Typescript that doesn't support
  // ReturnType. So this is ReturnType<Check> hard-coded.
  interface CheckReturn<TArgs> {
    result: boolean | Error,
    numTests: number,
    seed?: number,
    fail?: TArgs[] | TArgs, // The typings seem to disagreee here...
    failingSize?: number,
    shrunk?: {
      result: boolean | Error,
      smallest: TArgs[] | TArgs, // The typings seem to disagreee here...
      depth: number,
      totalNodesVisited: number,
    }
  };

  function logPropertyFail<T>(resp: CheckReturn<T>): void {
    if (resp.result && !(resp.result instanceof Error)) return;
    const smallestExample = resp.shrunk ? resp.shrunk.smallest : resp.fail;
    console.error(`Property failed to verify on input: ${JSON.stringify(smallestExample, null, 2)}`);
    console.error(JSON.stringify(resp.result, null, 2));
    if (resp.result instanceof Error) throw resp.result;
    assert(resp.result, `Property failed to verify! ${JSON.stringify(resp, null, 2)}`);
  }

  function assertProperty<T>(gen: Generator<T>, action: (a: T) => boolean | void, options?: CheckOptions) {
    const resp = check(property(gen, action), options);
    logPropertyFail<T>(resp);
  }

  const chicago = {
    // source: https://developers.google.com/maps/documentation/javascript/examples/map-coordinates#try-it-yourself
    worldCoords: {
      x: 65.6711111111,
      y: 95.17492654,
      type: 'WorldCoordinate' as 'WorldCoordinate',
    },
    latLng: { latitude: 41.850, longitude: -87.65 },
    pixelCoordinate: {
      zoom: 3 as 3,
      type: 'PixelCoordinate' as 'PixelCoordinate',
      x: 525.3688888888,
      y: 761.39941232,
    },
    tile: {
      zoom: 3 as 3,
      type: 'TileCoordinate' as 'TileCoordinate',
      x: 2, y: 2,
    },
  };

  describe('toWorldCoords', () => {
    it('correctly describes Chicago', () => {
      const asWorld = toWorldCoords(chicago.latLng);
      assertNearlyEqual(asWorld.x, chicago.worldCoords.x);
      assertNearlyEqual(asWorld.y, chicago.worldCoords.y);
    });
    it('is invertible with worldToLatLng', () => assertProperty(genLatLng, (ll: LatLong) => {
      const asWorld = toWorldCoords(ll);
      const backAgain = worldToLatLng(asWorld);
      assertNearlyEqual(ll.latitude, backAgain.latitude);
      assertNearlyEqual(ll.longitude, backAgain.longitude);
    }));
  });

  describe('worldToLatLng', () => {
    it('correctly describes Chicago', () => {
      const { latitude, longitude } = worldToLatLng(chicago.worldCoords);
      assertNearlyEqual(latitude, chicago.latLng.latitude);
      assertNearlyEqual(longitude, chicago.latLng.longitude);
    });
    it('is invertible with toWorldCoords', () => assertProperty(genWorldCoord, (wc: WorldCoordinate) => {
      const latLng = worldToLatLng(wc);
      const backAgain = toWorldCoords(latLng);
      assertNearlyEqual(wc.x, backAgain.x);
      assertNearlyEqual(wc.y, backAgain.y);
    }));

  });

  describe('worldToPixelCoords', () => {
    it('correctly describes Chicago', () => {
      const asPixel = worldToPixelCoords(chicago.worldCoords, 3);
      assertNearlyEqual(asPixel.x, chicago.pixelCoordinate.x);
      assertNearlyEqual(asPixel.y, chicago.pixelCoordinate.y);
    });

    it('is invertible with pixelToWorldCoords', () => assertProperty(
      gen.array([genWorldCoord, genZoomLevel]),
      ([wc, zoom]: [WorldCoordinate, GoogleZoom]) => {
        const asPixel = worldToPixelCoords(wc, zoom);
        const backAgain = pixelToWorldCoords(asPixel);
        assertNearlyEqual(backAgain.x, wc.x);
        assertNearlyEqual(backAgain.y, wc.y);
      }
    ));
  });

  describe('pixelToWorldCoords', () => {
    it('correctly describes Chicago', () => {
      const asWorld = pixelToWorldCoords(chicago.pixelCoordinate);
      assertNearlyEqual(asWorld.x, chicago.worldCoords.x);
      assertNearlyEqual(asWorld.y, chicago.worldCoords.y);
    });

    it('is invertible with worldToPixelCoords', () => assertProperty(
      genPixelCoords,
      (pc: PixelCoordinate) => {
        const asWorld = pixelToWorldCoords(pc);
        const backAgain = worldToPixelCoords(asWorld, pc.zoom);
        assertNearlyEqual(backAgain.x, pc.x);
        assertNearlyEqual(backAgain.y, pc.y);
      }
    ));
  });

  describe('pixelToTileCoords', () => {
    it('correctly describes Chicago', () => {
      const asTile = pixelToTileCoords(chicago.pixelCoordinate);
      expect(asTile).toEqual(chicago.tile);
    });
  });

  describe('tileToPixelCoordinates', () => {
    it('the center of a tile maps to the same tile', () => assertProperty(genTileCoord, (tc: TileCoordinate) => {
      const pixelBounds = tileToPixelCoords(tc);
      const center: PixelCoordinate = {
        x: (pixelBounds.topLeft.x + pixelBounds.bottomRight.x) / 2,
        y: (pixelBounds.topLeft.y + pixelBounds.bottomRight.y) / 2,
        type: 'PixelCoordinate',
        zoom: tc.zoom,
      };
      const tileAgain = pixelToTileCoords(center);
      expect(tileAgain).toEqual(tc);
    }));
    it('anywhere inside the tile bounds maps to the same tile', () => assertProperty(
      gen.array([genTileCoord, gen.numberWithin(0.001, 0.999), gen.numberWithin(0.001, 0.999)]),
      ([tc, xWeight, yWeight]) => {
        const pixelBounds = tileToPixelCoords(tc);
        const center: PixelCoordinate = {
          x: xWeight * pixelBounds.topLeft.x + (1 - xWeight) * pixelBounds.bottomRight.x,
          y: yWeight * pixelBounds.topLeft.y + (1 - yWeight) * pixelBounds.bottomRight.y,
          type: 'PixelCoordinate',
          zoom: tc.zoom,
        };
        const tileAgain = pixelToTileCoords(center);
        expect(tileAgain).toEqual(tc);
      }
    ));
  });

  const cityPark: LatLongBounds = {
    topLeft: {
      latitude: 39.754580779257104,
      longitude: -104.9599027633667,
    },
    bottomRight: {
      latitude:39.74382424830288,
      longitude: -104.940505027771,
    },
  };

  describe('tileCoordinates', () => {
    it('even a single-point extent contains a tile', () => assertProperty(
      gen.array([genLatLng, genZoomLevel]),
      ([ll, zoom]: [LatLong, GoogleZoom]) => {
        const tcs = tileCoordinates({ topLeft: ll, bottomRight: ll }, zoom);
        expect(tcs.length).toBe(1);
        const [tc] = tcs;
      }
    ));

    it('finds the tiles for city park', () => {
      const tcs10 = tileCoordinates(cityPark, 10);
      expect(tcs10.length).toBe(1);

      const tcs14 = tileCoordinates(cityPark, 14);
      expect(tcs14.length).toBe(2);

      const tcs15 = tileCoordinates(cityPark, 15);
      expect(tcs15.length).toBe(6);
    });
  });

  describe('chooseZoom', () => {
    it('makes a sensible choice for city park', () => {
      const zoom = chooseZoom(cityPark, 400);
      expect(zoom).toBe(14);
    });
  });

  describe('googleZoomMetersPerPx', () => {
    it('is invertible using googleZoomLevel', () => assertProperty(
      gen.array([genLatLng, genZoomLevel]),
      ([ll, zoom]) => {
        const metersPerPx = googleZoomMetersPerPx(ll, zoom);
        const backAgain = googleZoomLevel(ll, metersPerPx);
        expect(backAgain).toBe(zoom);
      }));
  });

  describe('googleZoomLevel', () => {
    it('gives the expected answer for very fine granularity', () => {
      const zoom = googleZoomLevel(chicago.latLng, 0.1);
      expect(zoom).toBe(20);
    });
    it('gives the expected answer for very zoomed out', () => {
      const zoom = googleZoomLevel(chicago.latLng, 1000000000);
      expect(zoom).toBe(1);
    });
  });
  const whitehouse: LatLong = {
    latitude: 38.898556,
    longitude: -77.037852,
  };
  const gwu: LatLong = {
    latitude: 38.897147,
    longitude: -77.043934,
  };

  describe('haversineMeters', () => {
    it('gives correct distance for Whitehouse to GWU', () => {
      const dist = haversineMeters(whitehouse, gwu);
      assertNearlyEqual(dist, 549, 1);
    });
    it('gives correct distance for Chicago to City Park', () => {
      const dist = haversineMeters(chicago.latLng, cityPark.topLeft);
      assertNearlyEqual(dist, 1473362, 100);
    });

    it('is commutative', () => assertProperty(
      gen.array([genLatLng, genLatLng]),
      ([pt1, pt2]) => assertNearlyEqual(
        haversineMeters(pt1, pt2),
        haversineMeters(pt2, pt1),
        1)));
  });
