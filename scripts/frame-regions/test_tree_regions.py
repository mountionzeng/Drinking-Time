import unittest
import numpy as np
from tree_regions import tree_points, tree_instance

class TreeRegions(unittest.TestCase):
    def test_color_alone_cannot_select_background_or_airplane(self):
        maps=np.zeros((2,100,100),np.float32);maps[0,10:90,10:90]=.8
        maps[1,40:70,40:70]=.95
        blue=np.ones((100,100),bool)
        points,coarse=tree_points(maps,.35,blue)
        self.assertTrue(points)
        self.assertTrue(all(coarse[y,x] for x,y in points))
        self.assertFalse(any(40<=x<70 and 40<=y<70 for x,y in points))
        blue[:]=False
        self.assertEqual(tree_points(maps,.35,blue)[0],[])

    def test_rejects_ground_and_warm_trunks_even_with_high_instance_score(self):
        masks=np.zeros((3,100,100),bool)
        masks[0]=True
        masks[1,20:40,20:40]=True
        masks[2,60:80,60:80]=True
        coarse=np.ones((100,100),bool)
        blue=np.zeros_like(coarse);blue[20:40,20:40]=True
        result=tree_instance(masks,np.array([.99,.8,.95]),coarse,blue)
        np.testing.assert_array_equal(result,masks[1])
        self.assertIsNone(tree_instance(masks,np.array([.99,.8,.95]),np.zeros_like(coarse),blue))
