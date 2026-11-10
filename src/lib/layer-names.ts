import { nanoid } from 'nanoid';
import type { Layer, LayerId, Sheet, SheetId } from '../types';

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

/** `Project.removedLayers`: how many layers the user has removed, per layer name key. */
export type RemovedLayerCounts = Record<string, number>;

const idPart = (key: string): string => key.replace(/\s+/g, '-');

// The id one of these layers gets when it has to be created: 'layer-underlay',
// 'layer-wire-labels'. It comes from the name, not from a random id, because in
// a shared room several peers can create the same layer at the same moment, and
// the project fields that hold the layers resolve as last writer wins. With the
// same id on every peer, whichever write wins, the layer is the one the other
// peers' entities point at. (A new project's standard layers keep random ids.)
//
// `removed` is how many layers the user has removed for the name. Each one
// after the first gets a number, 'layer-underlay-2', so the entities that were
// left on a removed layer are not on the next one.
const knownLayerId = (key: string, removed: number): LayerId =>
  removed === 0 ? `layer-${idPart(key)}` : `layer-${idPart(key)}-${removed + 1}`;

const KNOWN_KEY_BY_ID_PART = new Map<string, string>(
  [...KNOWN_LAYERS.keys()].map((key) => [idPart(key), key]),
);

// The name key and the number of earlier layers for an id made by knownLayerId.
const parseKnownLayerId = (id: string): { key: string; removed: number } | null => {
  const match = /^layer-(.+?)(?:-(\d+))?$/.exec(id);
  const key = match ? KNOWN_KEY_BY_ID_PART.get(match[1]) : undefined;
  if (!match || key === undefined) return null;
  if (match[2] === undefined) return { key, removed: 0 };
  const number = Number(match[2]);
  return number >= 2 && String(number) === match[2] ? { key, removed: number - 1 } : null;
};

const removedCount = (counts: RemovedLayerCounts | undefined, key: string): number => {
  const count = counts && typeof counts === 'object' ? counts[key] : undefined;
  return typeof count === 'number' && Number.isSafeInteger(count) && count > 0 ? count : 0;
};

/**
 * `Project.removedLayers` after the user removes `layer`. Only layers that
 * stand for one of the app's own layer names are counted: one with an id this
 * module made, or one that has such a name.
 */
export const withLayerRemoved = (
  counts: RemovedLayerCounts | undefined,
  layer: Layer | undefined,
): RemovedLayerCounts | undefined => {
  if (!layer) return counts;
  const byId = parseKnownLayerId(layer.id);
  const byName = typeof layer.name === 'string' && KNOWN_LAYERS.has(nameKey(layer.name)) ? nameKey(layer.name) : undefined;
  if (!byId && byName === undefined) return counts;
  const next: RemovedLayerCounts = { ...(counts && typeof counts === 'object' ? counts : {}) };
  if (byId) next[byId.key] = Math.max(removedCount(counts, byId.key), byId.removed + 1);
  if (byName !== undefined && byName !== byId?.key) next[byName] = removedCount(counts, byName) + 1;
  return next;
};

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
   * For repairing saved entities. Like `resolve`, but only for the names the
   * app's own generators and importers use, and the ids this resolver gives
   * the layers it creates for them. Null for anything else, and for a layer
   * the user removed: the entities left on it stay as they are.
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
 *
 * Which layer a name maps to depends only on the project, never on who asks or
 * when: the first layer with that name, else the layer with the name's own id
 * (it may have been renamed since), else a new layer with that id.
 */
export const createLayerNameResolver = (project: {
  layers: Record<LayerId, Layer>;
  layerOrder: LayerId[];
  removedLayers?: RemovedLayerCounts;
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

  const create = (id: LayerId, key: string, layer: LayerSpec): LayerId => {
    if (layers === project.layers) {
      layers = { ...project.layers };
      layerOrder = [...project.layerOrder];
    }
    layers[id] = layerFromSpec(id, layer);
    layerOrder.push(id);
    idByName.set(key, id);
    return id;
  };

  const removed = (key: string): number => removedCount(project.removedLayers, key);

  // The layer one of the app's own names stands for now, if the project has it:
  // the first layer with the name, else the one created for it and since renamed.
  const current = (key: string): LayerId | undefined => {
    const named = idByName.get(key);
    if (named !== undefined) return named;
    const id = knownLayerId(key, removed(key));
    return Object.hasOwn(layers, id) ? id : undefined;
  };

  return {
    resolve(ref) {
      if (Object.hasOwn(layers, ref)) return ref;
      const key = nameKey(ref);
      const known = KNOWN_LAYERS.get(key);
      // New entities for a name whose layer was removed get the next layer for it.
      if (known) return current(key) ?? create(knownLayerId(key, removed(key)), key, known);
      return (
        idByName.get(key)
        ?? create(nanoid(10), key, { name: ref, color: '#cccccc', visible: true, locked: false, lineWidth: 0.5 })
      );
    },
    resolveKnownName(ref) {
      if (Object.hasOwn(layers, ref)) return ref;
      const byId = parseKnownLayerId(ref);
      if (byId) {
        // An id this resolver gave a layer the project does not have. Either the
        // user removed that layer, which is recorded, and its entities stay as
        // they are. Or, in a shared room, a peer that never had the layer wrote
        // the project fields last, and the layer is created again.
        if (byId.removed < removed(byId.key)) return null;
        return idByName.get(byId.key) ?? create(ref, byId.key, KNOWN_LAYERS.get(byId.key)!);
      }
      const key = nameKey(ref);
      const known = KNOWN_LAYERS.get(key);
      if (!known) return null;
      // A layer name saved as a layer id. Once the user has removed the layer for
      // that name, what was saved by name was removed with it.
      if (removed(key) > 0) return null;
      return current(key) ?? create(knownLayerId(key, 0), key, known);
    },
    get layers() {
      return layers;
    },
    get layerOrder() {
      return layerOrder;
    },
  };
};

/**
 * Generated views and DXF/IFC imports used to be saved with a layer name
 * ('Annotation', 'underlay') as their layerId. No layer has such an id, so
 * those entities are never drawn. This points them at the layer with that
 * name, creating it when the project has none.
 *
 * An entity whose layer the user removed is left alone. Its layerId is either
 * an old random id, or the id of a layer this module created, in which case
 * `removedLayers` says it was removed (see withLayerRemoved). Without that
 * record, such an id whose layer is missing means the layer was lost in a
 * shared room, and it is created again.
 *
 * Copy-on-write: returns `project` itself when there is nothing to repair, and
 * otherwise a copy that shares every sheet and entity it did not change. The
 * result depends only on the project, so every peer that reads the same room
 * repairs it to the same thing.
 */
export const repairLayerNames = <
  P extends {
    layers: Record<LayerId, Layer>;
    layerOrder: LayerId[];
    removedLayers?: RemovedLayerCounts;
    sheets: Record<SheetId, Sheet>;
  },
>(project: P): P => {
  if (!project.layers || !Array.isArray(project.layerOrder) || !project.sheets) return project;
  const resolver = createLayerNameResolver(project);
  let sheets = project.sheets;
  for (const [sheetId, sheet] of Object.entries(project.sheets)) {
    if (!sheet?.entities) continue;
    let entities = sheet.entities;
    for (const [entityId, entity] of Object.entries(sheet.entities)) {
      if (typeof entity?.layerId !== 'string') continue;
      const layerId = resolver.resolveKnownName(entity.layerId);
      if (layerId === null || layerId === entity.layerId) continue;
      if (entities === sheet.entities) entities = { ...sheet.entities };
      entities[entityId] = { ...entity, layerId };
    }
    if (entities === sheet.entities) continue;
    if (sheets === project.sheets) sheets = { ...project.sheets };
    sheets[sheetId] = { ...sheet, entities };
  }
  if (sheets === project.sheets && resolver.layers === project.layers) return project;
  return { ...project, sheets, layers: resolver.layers, layerOrder: resolver.layerOrder };
};
