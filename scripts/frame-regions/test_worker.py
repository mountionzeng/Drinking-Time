import unittest
import numpy as np
from worker import select
from scene_palette import fit_palette

class Regions(unittest.TestCase):
    def test_other_objects_and_requested_half_are_protected(self):
        maps=np.zeros((7,40,60));maps[0,2:38,2:58]=.6;maps[1,10:20,10:20]=.9
        mask,protected,score=select(maps,'forest',.35,'left')
        self.assertGreater(score,0);self.assertTrue(protected[15,15]);self.assertFalse(mask[15,15]);self.assertFalse(mask[:,30:].any())
    def test_existing_green_is_required(self):
        rgb=np.full((40,40,3),[70,140,220],np.uint8);mask=np.ones((40,40),bool)
        with self.assertRaisesRegex(ValueError,'Insufficient'):
            fit_palette(rgb,mask,np.zeros_like(mask),source_mask=mask)
    def test_source_mask_stays_original_size(self):
        rgb=np.full((40,40,3),[70,140,220],np.uint8);mask=np.ones((40,40),bool)
        with self.assertRaisesRegex(ValueError,'source mask'):
            fit_palette(rgb,mask,np.zeros_like(mask),source_mask=mask[:20])

if __name__=='__main__':unittest.main()

class RecolorPixels(unittest.TestCase):
    def test_actual_worker_preserves_dimensions_and_all_unselected_pixels(self):
        from tempfile import TemporaryDirectory
        from pathlib import Path
        from PIL import Image
        from worker import recolor
        rgb=np.full((80,90,3),[240,220,190],np.uint8)
        mask=np.zeros((80,90),bool);mask[10:70,10:80]=True
        rgb[10:70,10:45]=[75,160,215];rgb[10:70,45:80]=[110,175,100]
        protected=np.zeros_like(mask);protected[30:40,30:40]=True
        with TemporaryDirectory() as folder:
            p=Path(folder)
            Image.fromarray(rgb).save(p/'source.png')
            Image.fromarray(mask.astype(np.uint8)*255).save(p/'mask.png')
            Image.fromarray(protected.astype(np.uint8)*255).save(p/'protected.png')
            result=recolor({'source':str(p/'source.png'),'mask':str(p/'mask.png'),'protected':str(p/'protected.png'),'output':folder})
            output=np.array(Image.open(result['path']))
            self.assertEqual(output.shape,rgb.shape)
            self.assertFalse(np.any(output[~mask]!=rgb[~mask]))
            self.assertFalse(np.any(output[protected]!=rgb[protected]))
            self.assertGreater(result['changedPixels'],100)

class CacheAndProposals(unittest.TestCase):
    def test_tiny_detection_is_unresolved(self):
        maps=np.zeros((7,100,100),np.float32)
        maps[1,10:14,10:18]=.8
        mask,_,_=select(maps,'plane',.35,'all')
        self.assertFalse(mask.any())

    def test_cache_reuses_maps_but_recomputes_corrupt_or_different_sources(self):
        from tempfile import TemporaryDirectory
        from pathlib import Path
        from worker import cached_maps
        calls=[]
        def compute():
            calls.append(1)
            return np.ones((7,40,40),np.float32)
        with TemporaryDirectory() as folder:
            p=Path(folder)
            first=cached_maps(p,'source-a',(7,40,40),compute)
            second=cached_maps(p,'source-a',(7,40,40),compute)
            np.testing.assert_array_equal(first,second)
            self.assertEqual(len(calls),1)
            (p/'source-a.npy').write_bytes(b'broken')
            cached_maps(p,'source-a',(7,40,40),compute)
            cached_maps(p,'source-b',(7,40,40),compute)
            self.assertEqual(len(calls),3)


class ObjectAndColorScope(unittest.TestCase):
    def test_palette_sampling_does_not_expand_the_edit_scope(self):
        from tempfile import TemporaryDirectory
        from pathlib import Path
        from PIL import Image
        from worker import recolor
        rgb=np.full((80,100,3),[240,220,190],np.uint8)
        objects=np.zeros((80,100),bool);objects[10:70,10:90]=True
        rgb[10:70,10:50]=[75,160,215]
        rgb[10:70,50:90]=[110,175,100]
        # Brown trunk inside the object, and a blue sky outside it.
        rgb[30:70,28:32]=[140,105,70];rgb[:8]=[75,160,215]
        edit=objects.copy();edit[:,50:]=False;edit[30:70,28:32]=False
        protection=np.zeros_like(edit);protection[20:30,15:25]=True
        with TemporaryDirectory() as folder:
            p=Path(folder)
            for name,data in [('source',rgb),('objects',objects),('mask',edit),('protected',protection)]:
                Image.fromarray(data if data.dtype==np.uint8 else data.astype(np.uint8)*255).save(p/(name+'.png'))
            result=recolor({**{name:str(p/(name+'.png')) for name in ['source','objects','mask','protected']},'output':folder})
            output=np.array(Image.open(result['path']))
            self.assertGreater(result['changedPixels'],500)
            np.testing.assert_array_equal(output[~edit],rgb[~edit])
            np.testing.assert_array_equal(output[protection],rgb[protection])
            self.assertEqual(output.shape,rgb.shape)
