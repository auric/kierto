import unittest

from catalog.validate import MAX_SKUS, BadRequest, parse_skus


class ParseSkusTest(unittest.TestCase):
    def test_keeps_the_order_and_drops_duplicates(self):
        self.assertEqual(parse_skus(["B-2", "A-1", "B-2"]), ["B-2", "A-1"])

    def test_refuses_too_many_or_none(self):
        with self.assertRaises(BadRequest):
            parse_skus([])
        with self.assertRaises(BadRequest):
            parse_skus([f"A-{i}" for i in range(MAX_SKUS + 1)])

    def test_refuses_a_bad_sku(self):
        with self.assertRaises(BadRequest):
            parse_skus(["A-1", "a-1"])
