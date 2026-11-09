import { nanoid } from 'nanoid';
import type { Layer, LayerId } from '../types';

type LayerSpec = Omit<Layer, 'id'>;

// The layers every new project starts with, in display order. View generators
// also ask for layers by these names, so a missing one is recreated to match.
export const STANDARD_LAYERS: LayerSpec[] = [
  { name: 'Wires', color: '#ff3a3a', visible: true, locked: false, lineWidth: 0.6 },
  { name: 'Symbols', color: '#e6e6e6', visible: true, locked: false, lineWidth: 0.5 },
  { name: 'Wire Labels', color: '#ffd84d', visible: true, locked: false, lineWidth: 0.4 },
  { name: 'Dimensions', color: '#5cdcff', visible: true, locked: false, lineWidth: 0.3 },
  { name: 'Annotation', color: '#9ad65a', visible: true, locked: false, lineWidth: 0.4 },
  { name: 'Panel Layout', color: '#bb8cff', visible: true, locked: false, lineWidth: 0.5 },
  { name: 'Containment', color: '#5cdcff', visible: true, locked: false, lineWidth: 0.6 },
  { name: 'Walls', color: '#a8aab0', visible: true, locked: false, lineWidth: 0.8 },
  { name: 'Rooms', color: '#7a8593', visible: true, locked: false, lineWidth: 0.3 },
  { name: 'Construction', color: '#5d6473', visible: true, locked: false, lineWidth: 0.3, lineDash: [4, 4] },
];

// Layers that are only created when something asks for them by name: DXF and
// IFC imports go on 'Underlay'.
const ON_DEMAND_LAYERS: LayerSpec[] = [
  { name: 'Underlay', color: '#7a8593', visible: true, locked: false, lineWidth: 0.3 },
];

const nameKey = (name: string): string => name.trim().toLowerCase();

const KNOWN_LAYERS = new Map<string, LayerSpec>(
  [...STANDARD_LAYERS, ...ON_DEMAND_LAYERS].map((spec) => [nameKey(spec.name), spec]),
);

// Each layer gets its own lineDash array: committed projects are frozen in dev builds.
export const layerFromSpec = (id: LayerId, spec: LayerSpec): Layer => ({
  id,
  ...spec,
  ...(spec.lineDash ? { lineDash: [...spec.lineDash] } : {}),
});

export interface LayerNameResolver {
  /**
   * The id of the layer `ref` refers to: `ref` itself when it is a layer id,
   * otherwise the layer with that name, created if the project has none.
   */
  resolve(ref: string): LayerId;
  /**
   * Like `resolve`, but only for the names the app's own generators and
   * importers use. Null for anything else, such as the id of a deleted layer.
   */
  resolveKnownName(ref: string): LayerId | null;
  /** The project's layers, including any that were created. */
  readonly layers: Record<LayerId, Layer>;
  readonly layerOrder: LayerId[];
}

/**
 * Maps layer names to layer ids for one project. View generators and importers
 * run without knowing a project's layer ids, so they put a layer name
 * ('Annotation', 'Underlay') in `layerId`. Layers are keyed by id, and an
 * entity on an unknown layer is never drawn.
 *
 * `layers` and `layerOrder` are the project's own objects until a layer has to
 * be created; they are then replaced by copies, so the input is never mutated.
 */
export const createLayerNameResolver = (project: {
  layers: Record<LayerId, Layer>;
  layerOrder: LayerId[];
}): LayerNameResolver => {
  let layers = project.layers;
  let layerOrder = project.layerOrder;
  const idByName = new Map<string, LayerId>();
  for (const id of layerOrder) {
    const layer = layers[id];
    if (layer && typeof layer.name === 'string' && !idByName.has(nameKey(layer.name))) {
      idByName.set(nameKey(layer.name), id);
    }
  }

  const create = (key: string, layer: LayerSpec): LayerId => {
    const id = nanoid(10);
    if (layers === project.layers) {
      layers = { ...project.layers };
      layerOrder = [...project.layerOrder];
    }
    layers[id] = layerFromSpec(id, layer);
    layerOrder.push(id);
    idByName.set(key, id);
    return id;
  };

  return {
    resolve(ref) {
      if (Object.hasOwn(layers, ref)) return ref;
      const key = nameKey(ref);
      return (
        idByName.get(key)
        ?? create(key, KNOWN_LAYERS.get(key) ?? { name: ref, color: '#cccccc', visible: true, locked: false, lineWidth: 0.5 })
      );
    },
    resolveKnownName(ref) {
      if (Object.hasOwn(layers, ref)) return ref;
      const key = nameKey(ref);
      const known = KNOWN_LAYERS.get(key);
      if (!known) return null;
      return idByName.get(key) ?? create(key, known);
    },
    get layers() {
      return layers;
    },
    get layerOrder() {
      return layerOrder;
    },
  };
};
