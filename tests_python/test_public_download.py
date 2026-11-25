import io
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pypdf import PdfWriter

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from download_bridge import download, pmc_candidates, public_url


class PublicDownloadTest(unittest.TestCase):
    def test_official_routes_are_scoped_to_the_article_and_known_hosts(self):
        url = 'https://pmc-oa-opendata.s3.amazonaws.com/PMC42.2/paper.pdf?md5=482f350c6fde680a3e45c3374d550c4b'
        self.assertIn(url, pmc_candidates('PMC42', url))
        self.assertNotIn(url, pmc_candidates('PMC43', url))
        self.assertFalse(public_url('https://pmc.ncbi.nlm.nih.gov.example.com/file.pdf'))
        self.assertFalse(public_url('https://user:pass@pmc.ncbi.nlm.nih.gov/file.pdf'))
        self.assertFalse(public_url('http://127.0.0.1:4317/'))

    def test_plain_install_downloads_declared_publisher_pdf_with_matching_title(self):
        title = 'A public study of medical foundation models'
        writer = PdfWriter()
        writer.add_blank_page(width=400, height=600)
        writer.add_metadata({'/Title': title})
        document = io.BytesIO()
        writer.write(document)
        page = 'https://www.nature.com/articles/test'
        pdf = page + '.pdf'
        urls = {
            'https://doi.org/10.1038/test': (page, f'<meta name="citation_pdf_url" content="{pdf}">'.encode()),
            pdf: (pdf, document.getvalue()),
        }
        with tempfile.TemporaryDirectory() as target:
            with (
                patch('download_bridge.europe_pmc_candidates', return_value=[]),
                patch('download_bridge.fetch', side_effect=lambda url, *_: urls[url]),
            ):
                result = download({'pmid':'42', 'doi':'10.1038/test', 'title':title, 'output_dir':target})
            self.assertEqual(result['status'], 'ready')
            self.assertEqual(result['identity'], 'title')
            self.assertEqual(Path(target, result['file_name']).read_bytes(), document.getvalue())
