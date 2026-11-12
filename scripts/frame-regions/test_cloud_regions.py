import unittest
import numpy as np
from PIL import Image
from cloud_regions import cloud_support, semantic_points, choose_instance, finish_mask, tiled_maps

class CloudRegions(unittest.TestCase):
    def test_points_cover_disconnected_clouds_without_manual_coordinates(self):
        maps=np.zeros((7,160,240),np.float32)
        maps[2,5:70,5:110]=.8
        maps[2,95:145,175:225]=.5
        points,_,_=semantic_points(maps,.35)
        self.assertTrue(any(x<110 and y<70 for x,y in points))
        self.assertTrue(any(x>175 and y>95 for x,y in points))
        self.assertLessEqual(len(points),64)
        self.assertEqual(semantic_points(np.zeros_like(maps),.35)[0],[])

    def test_large_background_and_protected_airplane_are_not_selected(self):
        eligible=np.ones((100,100),bool);protected=np.zeros_like(eligible)
        variants=np.zeros((3,100,100),bool)
        variants[0]=True
        variants[1,20:40,20:40]=True
        variants[2,60:80,60:80]=True;protected[60:80,60:80]=True
        selected=choose_instance(variants,np.array([.99,.8,.95]),eligible,protected)
        np.testing.assert_array_equal(selected,variants[1])

    def test_low_semantic_support_rejects_confident_foreign_object(self):
        variants=np.zeros((1,30,30),bool);variants[:,5:15,5:15]=True
        self.assertIsNone(choose_instance(variants,np.array([.99]),np.zeros((30,30),bool),np.zeros((30,30),bool)))

    def test_tree_spill_and_airplane_pixels_are_removed_at_native_size(self):
        maps=np.zeros((7,100,120),np.float32);maps[2,5:90,5:100]=.6
        maps[1,40:50,40:50]=.9
        _,protected=cloud_support(maps,.35)
        result=finish_mask(np.ones((100,120),bool),maps,protected)
        self.assertEqual(result.shape,(100,120))
        self.assertFalse(result[40:50,40:50].any())
        self.assertFalse(result[:,105:].any())
        self.assertTrue(result[20,20])

    def test_overlapping_crops_cover_rectangular_native_image_without_seams(self):
        image=Image.new('RGB',(120,80));calls=[]
        def predict(crop):
            calls.append(crop.size)
            return np.full((7,crop.height,crop.width),.42,np.float32)
        result=tiled_maps(image,predict)
        self.assertEqual(result.shape,(7,80,120));self.assertEqual(len(calls),4)
        np.testing.assert_allclose(result,.42,atol=1e-6)
