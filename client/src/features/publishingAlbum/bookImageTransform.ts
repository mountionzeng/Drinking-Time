import { bookImageText, readBookImage } from './bookImageBlock';
import { transformModule, type ImageModule, type ModuleHandle } from './imagePackModules';

/** Use the layout editor's exact geometry; the book reserves a flow slot around it. */
export function bookImageModule(text: string, factor: number): ImageModule | null {
  const image = readBookImage(text);
  return image ? { id: 'book-image', kind: 'image', imageUrl: image.url,
    rect: image.frame ?? {x:0,y:0,width:900,height:300*image.scale/factor}, crop:image.crop } : null;
}
export function transformBookImage(text: string, module: ImageModule, handle: ModuleHandle, dx: number, dy: number): string {
  const image = readBookImage(text)!;
  const next = transformModule(module, handle, dx, dy) as ImageModule;
  return bookImageText(image.url, next.crop, image.scale, next.rect);
}
