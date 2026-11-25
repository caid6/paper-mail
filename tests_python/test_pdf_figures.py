import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import fitz


SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "extract_pdf_figures.py"


class PdfFigureExtractionTest(unittest.TestCase):
    def create_pdf(self, folder: Path) -> Path:
        document = fitz.open()
        page = document.new_page(width=600, height=800)
        page.insert_text((60, 60), "Clinical figure extraction test", fontsize=14)
        page.draw_rect(fitz.Rect(80, 120, 520, 390), color=(0.1, 0.2, 0.8), width=3)
        page.draw_line((80, 340), (520, 140), color=(0.8, 0.1, 0.1), width=3)
        page.insert_text((90, 440), "Figure 1. Model performance across validation cohorts.", fontsize=11)
        page.draw_rect(fitz.Rect(80, 500, 520, 680), color=(0.2, 0.6, 0.3), width=3)
        page.insert_text((90, 720), "Supplementary Figure 1. Training details.", fontsize=10)
        source = folder / "paper.pdf"
        document.save(source)
        document.close()
        return source

    def test_renders_numbered_main_figures_and_excludes_supplementary(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            source = self.create_pdf(folder)
            output = folder / "figures"
            result = subprocess.run(
                [sys.executable, str(SCRIPT)],
                input=json.dumps({"file": str(source), "output_dir": str(output)}),
                text=True,
                capture_output=True,
                check=True,
            )
            parsed = json.loads(result.stdout)
            self.assertTrue(parsed["ok"])
            self.assertEqual(parsed["pages"], 1)
            self.assertEqual(len(parsed["figures"]), 1)
            figure = parsed["figures"][0]
            self.assertEqual(figure["label"], "Figure 1")
            self.assertIn("Model performance across validation cohorts", figure["caption"])
            image = fitz.open(output / figure["file"])
            pixmap = image[0].get_pixmap()
            self.assertGreater(pixmap.width, 1000)
            self.assertGreater(pixmap.height, 400)
            self.assertGreater(len(set(pixmap.samples)), 10)
            image.close()

    def test_requires_an_explicit_numbered_figure_caption(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            document = fitz.open()
            page = document.new_page()
            page.draw_rect(fitz.Rect(60, 60, 500, 400))
            page.insert_text((60, 450), "Clinical results and model output", fontsize=12)
            source = folder / "paper.pdf"
            document.save(source)
            document.close()
            result = subprocess.run(
                [sys.executable, str(SCRIPT)],
                input=json.dumps({"file": str(source), "output_dir": str(folder / "figures")}),
                text=True,
                capture_output=True,
                check=True,
            )
            self.assertEqual(json.loads(result.stdout)["figures"], [])

    def test_accepts_caption_lines_without_punctuation(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            document = fitz.open()
            page = document.new_page()
            page.draw_rect(fitz.Rect(60, 60, 500, 360))
            page.insert_text((60, 430), "Fig. 1 – Main study result", fontsize=12)
            page.draw_rect(fitz.Rect(60, 480, 500, 650))
            page.insert_text((60, 700), "Figure 2 Study design", fontsize=12)
            source = folder / "paper.pdf"
            document.save(source)
            document.close()
            result = subprocess.run(
                [sys.executable, str(SCRIPT)],
                input=json.dumps({"file": str(source), "output_dir": str(folder / "figures")}),
                text=True,
                capture_output=True,
                check=True,
            )
            figures = json.loads(result.stdout)["figures"]
            self.assertEqual([figure["label"] for figure in figures], ["Figure 1", "Figure 2"])
            self.assertIn("Main study result", figures[0]["caption"])
            self.assertIn("Study design", figures[1]["caption"])

    def test_finds_a_figure_caption_after_body_text_in_the_same_pdf_block(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            document = fitz.open()
            page = document.new_page()
            page.insert_textbox(
                fitz.Rect(60, 70, 520, 180),
                "The section begins with body text before the caption.\nFigure 3 – Main result across validation cohorts.",
                fontsize=12,
            )
            source = folder / "paper.pdf"
            document.save(source)
            document.close()
            result = subprocess.run(
                [sys.executable, str(SCRIPT)],
                input=json.dumps({"file": str(source), "output_dir": str(folder / "figures")}),
                text=True,
                capture_output=True,
                check=True,
            )
            figures = json.loads(result.stdout)["figures"]
            self.assertEqual(len(figures), 1)
            self.assertEqual(figures[0]["label"], "Figure 3")
            self.assertIn("Main result", figures[0]["caption"])


if __name__ == "__main__":
    unittest.main()
