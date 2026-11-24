import unittest
import numpy as np
from worker import select
from scene_palette import fit_palette

class Regions(unittest.TestCase):
    def test_harmonized_preview_excludes_plane_trunks_and_other_semantic_objects(self):
        from PIL import Image
        from worker import forest_foliage_scope
        rgb=np.array([[[90,150,100],[75,150,210],[240,240,235],[140,90,60],[80,160,115]]],np.uint8)
        mask=np.ones((1,5),bool);protected=np.zeros_like(mask);protected[0,4]=True
        selected=forest_foliage_scope(Image.fromarray(rgb),mask,protected,mask)
        np.testing.assert_array_equal(selected,[[True,True,False,False,False]])

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
    def test_harmonized_greens_keep_shading_trunks_and_unselected_pixels(self):
        from tempfile import TemporaryDirectory
        from pathlib import Path
        from PIL import Image
        from worker import recolor
        from recolor_selection import to_lab, linear_rgb
        rgb=np.full((80,100,3),[240,220,190],np.uint8)
        mask=np.zeros((80,100),bool);mask[10:70,10:90]=True
        # Blue, yellow-green and turquoise foliage at several lightness levels.
        for x,color in [(10,[75,155,210]),(35,[130,180,85]),(60,[65,160,135])]:
            for y in range(10,70):
                rgb[y,x:x+25]=np.array(color)*(.7+.3*(y-10)/60)
        rgb[35:55,45:50]=[130,95,55]
        protected=np.zeros_like(mask);protected[20:30,20:30]=True
        with TemporaryDirectory() as folder:
            p=Path(folder)
            for name,arr in [('source',rgb),('mask',mask.astype(np.uint8)*255),('protected',protected.astype(np.uint8)*255)]:
                Image.fromarray(arr).save(p/f'{name}.png')
            result=recolor({'source':str(p/'source.png'),'mask':str(p/'mask.png'),
                            'protected':str(p/'protected.png'),'output':folder,'tone':'harmonize_green'})
            output=np.array(Image.open(result['path']))
            # A separate, frozen recipe reduces residual blue in shadows without
            # changing the confirmed mask or repeating the previous candidate.
            from PIL import PngImagePlugin
            import struct
            meta=PngImagePlugin.PngInfo();meta.add(b'gAMA',struct.pack('>I',45455))
            Image.fromarray(rgb).save(p/'source.png',pnginfo=meta)
            stronger=recolor({'source':str(p/'source.png'),'mask':str(p/'mask.png'),
                              'protected':str(p/'protected.png'),'output':folder,'tone':'harmonize_green_less_blue'})
            with Image.open(stronger['path']) as image:
                self.assertEqual(image.info.get('gamma'),.45455)
                strong=np.array(image)
            np.testing.assert_array_equal(strong[~mask],rgb[~mask])
            np.testing.assert_array_equal(strong[protected],rgb[protected])
            np.testing.assert_array_equal(strong[35:55,45:50],rgb[35:55,45:50])
            self.assertLess(np.abs(to_lab(linear_rgb(strong))[...,0]-to_lab(linear_rgb(rgb))[...,0]).max(),.5)
            self.assertGreater(np.count_nonzero(np.any(strong!=output,axis=-1)),100)
            # In the blue shadow patch, positive Lab b means less residual blue.
            self.assertGreater(to_lab(linear_rgb(strong))[15:20,15:30,2].mean(),to_lab(linear_rgb(output))[15:20,15:30,2].mean())
            before,after=to_lab(linear_rgb(rgb)),to_lab(linear_rgb(output))
            self.assertEqual(output.shape,rgb.shape)
            np.testing.assert_array_equal(output[~mask],rgb[~mask])
            np.testing.assert_array_equal(output[protected],rgb[protected])
            np.testing.assert_array_equal(output[35:55,45:50],rgb[35:55,45:50])
            self.assertLess(np.abs(before[...,0]-after[...,0]).max(),.5)
            self.assertGreater(result['changedPixels'],500)
            # Consistency also adjusts mismatched existing green, not only blue.
            self.assertTrue(np.any(output[50:65,65:80]!=rgb[50:65,65:80]))
            self.assertGreater(np.std(after[...,0][mask]),3)

    def test_inherited_softened_palette_also_changes_blue_forest_without_reducing_it_twice(self):
        from tempfile import TemporaryDirectory
        from pathlib import Path
        from PIL import Image
        from worker import recolor
        rgb=np.full((80,90,3),[240,220,190],np.uint8)
        mask=np.zeros((80,90),bool);mask[10:70,10:80]=True
        rgb[mask]=[75,160,215]
        rgb[40:55,35:45]=[120,85,60]  # brown trunks stay unchanged
        protected=np.zeros_like(mask);protected[30:40,30:40]=True
        ref=rgb.copy();ref[mask]=[128,167,125]
        with TemporaryDirectory() as folder:
            p=Path(folder)
            for name,arr in [('source',rgb),('reference',ref),('mask',mask.astype(np.uint8)*255),('protected',protected.astype(np.uint8)*255)]:
                Image.fromarray(arr).save(p/f'{name}.png')
            request={'source':str(p/'source.png'),'mask':str(p/'mask.png'),'objects':str(p/'mask.png'),
                     'protected':str(p/'protected.png'),'output':folder,
                     'reference':{'source':str(p/'reference.png'),'mask':str(p/'mask.png'),'objects':str(p/'mask.png'),'protection':str(p/'protected.png')}}
            result=recolor({**request,'tone':'reduce_green_flatness'})
            output=np.array(Image.open(result['path']))
            self.assertGreater(result['changedPixels'],100)
            self.assertGreater(int(output[20,20,1]),int(output[20,20,2]))
            np.testing.assert_array_equal(output[~mask],rgb[~mask])
            np.testing.assert_array_equal(output[protected],rgb[protected])
            np.testing.assert_array_equal(output[40:55,35:45],rgb[40:55,35:45])

    def test_less_green_keeps_luminance_texture_and_other_objects(self):
        from scene_palette import soften_forest_green
        from recolor_selection import to_lab, linear_rgb
        yy,xx=np.mgrid[:80,:90]
        rgb=np.stack([70+xx//2,120+yy,65+xx//3],axis=-1).astype(np.uint8)
        mask=np.zeros((80,90),bool);mask[10:70,10:80]=True
        protected=np.zeros_like(mask);protected[30:40,30:40]=True
        rgb[50:60,50:60]=[65,100,160]  # Existing blue shade must remain blue.
        out=soften_forest_green(rgb,mask,protected,mask)
        before,after=to_lab(linear_rgb(rgb)),to_lab(linear_rgb(out))
        active=mask&~protected
        self.assertLess(np.median(np.linalg.norm(after[active,1:],axis=-1)),np.median(np.linalg.norm(before[active,1:],axis=-1)))
        self.assertLess(np.abs(before[...,0]-after[...,0]).max(),.5)
        np.testing.assert_array_equal(out[~mask],rgb[~mask])
        np.testing.assert_array_equal(out[protected],rgb[protected])
        np.testing.assert_array_equal(out[50:60,50:60],rgb[50:60,50:60])
        self.assertGreater(np.std(after[active,1:]),1)

    def test_actual_worker_preserves_dimensions_and_all_unselected_pixels(self):
        from tempfile import TemporaryDirectory
        from pathlib import Path
        from PIL import Image
        from worker import recolor
        rgb=np.full((80,90,3),[240,220,190],np.uint8)
        mask=np.zeros((80,90),bool);mask[10:70,10:80]=True
        rgb[10:70,10:45]=[75,160,215];rgb[10:70,45:80]=[110,175,100]
        rgb[40:55,65:70]=[130,95,55]  # Tree detection may include warm trunks.
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
            np.testing.assert_array_equal(output[10:70,45:80],rgb[10:70,45:80])

class CacheAndProposals(unittest.TestCase):
    def test_open_vocabulary_bounds_absence_and_private_cache(self):
        from pathlib import Path
        from tempfile import TemporaryDirectory
        from unittest.mock import Mock, patch
        from PIL import Image
        from worker import locate_objects
        scores = np.zeros((2, 40, 80), dtype=np.float32)
        scores[0, 20:32, 8:24] = .8
        scores[1, 1:3, 1:3] = .95
        predict = Mock(return_value=scores)
        with TemporaryDirectory() as folder, patch('worker.model_fingerprint', return_value='weights'), patch('worker.image_predictor', return_value=predict):
            p = Path(folder)
            source = p / 'frame.png'
            Image.new('RGB', (80, 40)).save(source)
            request = dict(source=str(source), cachePath=str(p / 'cache'), scope='project-a', modelPath=folder, prompts=['violin', 'boat'])
            expected = [[[.1, .5, .3, .8]], []]
            self.assertEqual(locate_objects(request), expected)
            self.assertEqual(locate_objects(request), expected)
            self.assertEqual(predict.call_count, 1)
            self.assertEqual(locate_objects(dict(request, scope='project-b')), expected)
            self.assertEqual(predict.call_count, 2)

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
    def test_cross_frame_palette_uses_only_reference_trees_and_keeps_target_size(self):
        from scene_palette import palette_target, encode
        rgb=np.full((70,90,3),[75,160,215],np.uint8)
        objects=np.ones(rgb.shape[:2],bool)
        protected=np.zeros_like(objects)
        reference=np.full((50,60,3),[110,175,100],np.uint8)
        reference_objects=np.zeros(reference.shape[:2],bool);reference_objects[10:40,10:50]=True
        kwargs=dict(source_mask=objects,reference_rgb=reference,reference_objects=reference_objects,
                    reference_protected=np.zeros_like(reference_objects),reference_mask=reference_objects)
        model,_=fit_palette(rgb,objects,protected,**kwargs)
        output=encode(palette_target(rgb,model))
        self.assertEqual(output.shape,rgb.shape)
        self.assertGreater(int(output[30,30,1]),int(output[30,30,2]))
        reference[~reference_objects]=[200,50,200]
        same,_=fit_palette(rgb,objects,protected,**kwargs)
        self.assertEqual(model,same)
        reference[reference_objects]=[90,175,145]
        changed,_=fit_palette(rgb,objects,protected,**kwargs)
        self.assertNotEqual(model['rows'],changed['rows'])

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
