import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from openalex_sources import candidate_urls, matches_doi


class OpenAlexSourcesTest(unittest.TestCase):
    def test_requires_matching_doi_and_open_location(self):
        work = {
            "doi": "https://doi.org/10.1234/ABC",
            "locations": [
                {"is_oa": True, "pdf_url": "https://repo.example/paper.pdf", "landing_page_url": "https://repo.example/paper"},
                {"is_oa": False, "pdf_url": "https://publisher.example/paper.pdf"},
            ],
        }
        self.assertTrue(matches_doi(work, "10.1234/abc"))
        self.assertEqual(
            candidate_urls(work, "10.1234/abc"),
            ["https://repo.example/paper.pdf", "https://repo.example/paper"],
        )
        with self.assertRaisesRegex(ValueError, "DOI"):
            candidate_urls(work, "10.5678/other")

    def test_discards_invalid_and_duplicate_urls(self):
        work = {
            "doi": "10.1234/abc",
            "locations": [
                {"is_oa": True, "pdf_url": "javascript:alert(1)", "landing_page_url": "https://repo.example/paper"},
                {"is_oa": True, "pdf_url": "https://repo.example/paper"},
            ],
        }
        self.assertEqual(candidate_urls(work, "10.1234/abc"), ["https://repo.example/paper"])


if __name__ == "__main__":
    unittest.main()
