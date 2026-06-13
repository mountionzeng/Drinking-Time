import { canonicalizeShotNo, type ImageAsset } from '@shared/imageAsset';

export type ShotAssetGroup = {
  shotNo: string;
  assets: ImageAsset[];
  primary: ImageAsset | null;
  preview: ImageAsset | null;
};

export type ImageAssetWorkspaceModel = {
  shotGroups: Map<string, ShotAssetGroup>;
  unassigned: ImageAsset[];
  styleReferences: ImageAsset[];
};

function assetRank(asset: ImageAsset): number {
  if (asset.isPrimary) return 0;
  if (asset.status === 'pending') return 1;
  if (asset.status === 'selected') return 2;
  return 3;
}

function sortAssets(left: ImageAsset, right: ImageAsset): number {
  const rank = assetRank(left) - assetRank(right);
  if (rank !== 0) return rank;
  const time = Date.parse(right.createdAt) - Date.parse(left.createdAt);
  return time || right.id - left.id;
}

export function buildImageAssetWorkspace(
  assets: ImageAsset[],
  shotNos: string[],
): ImageAssetWorkspaceModel {
  const shotGroups = new Map<string, ShotAssetGroup>();
  for (const shotNo of shotNos) {
    const canonical = canonicalizeShotNo(shotNo);
    if (!canonical || shotGroups.has(canonical)) continue;
    shotGroups.set(canonical, {
      shotNo: canonical,
      assets: [],
      primary: null,
      preview: null,
    });
  }

  const unassigned: ImageAsset[] = [];
  const styleReferences: ImageAsset[] = [];
  for (const asset of assets) {
    if (asset.assignment === 'style_reference') {
      styleReferences.push(asset);
      continue;
    }
    const group = asset.canonicalShotNo
      ? shotGroups.get(asset.canonicalShotNo)
      : undefined;
    if (!group || asset.assignment === 'unassigned') {
      unassigned.push(asset);
      continue;
    }
    group.assets.push(asset);
  }

  for (const group of Array.from(shotGroups.values())) {
    group.assets.sort(sortAssets);
    group.primary = group.assets.find(asset => asset.isPrimary) ?? null;
    group.preview =
      group.primary ??
      group.assets.find(asset => asset.status === 'pending') ??
      group.assets[0] ??
      null;
  }

  unassigned.sort(sortAssets);
  styleReferences.sort(sortAssets);
  return { shotGroups, unassigned, styleReferences };
}
