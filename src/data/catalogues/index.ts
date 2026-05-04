// Default catalogue assembly — bundles per-category product lists into
// a single Catalogue map keyed by manufacturer + range.

import type { Catalogue, CatalogueProduct, CatalogueCategory } from '../../models/catalogue';
import { CABLE_TRAY_PRODUCTS } from './cable-tray';
import { CABLE_LADDER_PRODUCTS } from './cable-ladder';
import { CABLE_BASKET_PRODUCTS } from './cable-basket';
import { TRUNKING_PRODUCTS } from './trunking';
import { CONDUIT_PRODUCTS } from './conduit';
import { FITTING_PRODUCTS } from './fittings';
import { SUPPORT_PRODUCTS } from './supports';
import { FIRE_STOP_PRODUCTS } from './fire-stops';

const allProducts = (): CatalogueProduct[] => [
  ...CABLE_TRAY_PRODUCTS,
  ...CABLE_LADDER_PRODUCTS,
  ...CABLE_BASKET_PRODUCTS,
  ...TRUNKING_PRODUCTS,
  ...CONDUIT_PRODUCTS,
  ...FITTING_PRODUCTS,
  ...SUPPORT_PRODUCTS,
  ...FIRE_STOP_PRODUCTS,
];

export const loadDefaultCatalogues = (): Record<string, Catalogue> => {
  const products = allProducts();
  const productMap: Record<string, CatalogueProduct> = {};
  const productOrder: string[] = [];
  for (const p of products) {
    productMap[p.id] = p;
    productOrder.push(p.id);
  }
  const cat: Catalogue = {
    id: 'default',
    name: 'OpenCAD Default Catalogue',
    products: productMap,
    productOrder,
  };
  return { default: cat };
};

export const findProductsByCategory = (
  catalogues: Record<string, Catalogue>,
  category: CatalogueCategory,
): CatalogueProduct[] => {
  const out: CatalogueProduct[] = [];
  for (const cat of Object.values(catalogues)) {
    for (const id of cat.productOrder) {
      const p = cat.products[id];
      if (p && p.category === category) out.push(p);
    }
  }
  return out;
};

export const findProductByPartNumber = (
  catalogues: Record<string, Catalogue>,
  partNumber: string,
): CatalogueProduct | undefined => {
  for (const cat of Object.values(catalogues)) {
    for (const id of cat.productOrder) {
      const p = cat.products[id];
      if (p && p.partNumber === partNumber) return p;
    }
  }
  return undefined;
};

export const findSubstitutes = (
  catalogues: Record<string, Catalogue>,
  productId: string,
): CatalogueProduct[] => {
  let target: CatalogueProduct | undefined;
  for (const cat of Object.values(catalogues)) {
    target = cat.products[productId];
    if (target) break;
  }
  if (!target?.substitutionGroup) return [];
  const out: CatalogueProduct[] = [];
  for (const cat of Object.values(catalogues)) {
    for (const id of cat.productOrder) {
      const p = cat.products[id];
      if (p && p.id !== productId && p.substitutionGroup === target.substitutionGroup) {
        out.push(p);
      }
    }
  }
  return out;
};

export const findProductById = (
  catalogues: Record<string, Catalogue>,
  id: string,
): CatalogueProduct | undefined => {
  for (const cat of Object.values(catalogues)) {
    if (cat.products[id]) return cat.products[id];
  }
  return undefined;
};
