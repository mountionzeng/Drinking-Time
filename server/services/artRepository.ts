import * as fs from "fs";
import * as path from "path";

export interface ArtReferenceFeature {
  artStyle: string;
  artistReference?: string;
  dominantColors: string[];
  colorTone: string;
  lightingCharacter: string;
  mood: string[];
  composition: string;
  materials: string[];
  cameraAngle: string;
  visualDescription: string;
}

export interface FeaturesCache {
  [filename: string]: ArtReferenceFeature;
}

class ArtRepository {
  private cache: FeaturesCache | null = null;
  private cacheFilePath: string;

  constructor() {
    this.cacheFilePath = path.join(process.cwd(), "art-repository", "features-cache.json");
  }

  loadFeaturesCache(): FeaturesCache {
    if (this.cache) {
      return this.cache;
    }

    try {
      if (!fs.existsSync(this.cacheFilePath)) {
        console.warn(`Features cache not found at ${this.cacheFilePath}`);
        this.cache = {};
        return this.cache;
      }

      const fileContent = fs.readFileSync(this.cacheFilePath, "utf-8");
      const parsed = JSON.parse(fileContent) as FeaturesCache;
      this.cache = parsed;
      console.log(`✓ Loaded art reference cache with ${Object.keys(this.cache as FeaturesCache).length} images`);
      return this.cache;
    } catch (error) {
      console.error(`Failed to load features cache: ${error}`);
      this.cache = {};
      return this.cache;
    }
  }

  getCache(): FeaturesCache {
    if (!this.cache) {
      return this.loadFeaturesCache();
    }
    return this.cache;
  }

  getFeatures(filename: string): ArtReferenceFeature | undefined {
    const cache = this.getCache();
    return cache[filename];
  }

  getAllReferences(): Array<[string, ArtReferenceFeature]> {
    const cache = this.getCache();
    return Object.entries(cache);
  }

  getImageCount(): number {
    return Object.keys(this.getCache()).length;
  }
}

let artRepositoryInstance: ArtRepository | null = null;

export function getArtRepository(): ArtRepository {
  if (!artRepositoryInstance) {
    artRepositoryInstance = new ArtRepository();
  }
  return artRepositoryInstance;
}
