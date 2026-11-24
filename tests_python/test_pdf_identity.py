import sys
import tempfile
import unittest
from pathlib import Path
from pypdf import PdfWriter

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from pdf_identity import verify_pdf


class PdfIdentityTest(unittest.TestCase):
    def create_pdf(self, target, title):
        path = target / "paper.pdf"
        writer = PdfWriter()
        writer.add_blank_page(width=600, height=800)
        writer.add_metadata({"/Title": title})
        with path.open("wb") as stream:
            writer.write(stream)
        return path

    def test_accepts_exact_metadata_title_without_visible_doi(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            pdf = self.create_pdf(target, "Clinical foundation models")
            result = verify_pdf(pdf, target, "10.1234/abc", "Clinical foundation models.")
            self.assertEqual(result, {"pages": 1, "identity": "title"})

    def test_rejects_another_paper_instead_of_accepting_any_readable_pdf(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            pdf = self.create_pdf(target, "Unrelated paper")
            with self.assertRaisesRegex(ValueError, "DOI/标题"):
                verify_pdf(pdf, target, "10.1234/abc", "Clinical foundation models")

    def test_requires_file_inside_paper_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory)
            pdf = self.create_pdf(target, "Clinical foundation models")
            with self.assertRaisesRegex(ValueError, "路径"):
                verify_pdf(pdf, target / "other", "10.1234/abc", "Clinical foundation models")


if __name__ == "__main__":
    unittest.main()
