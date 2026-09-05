import importlib.util
import pathlib
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('hoa_document_archive', pathlib.Path(__file__).parents[1] / 'scripts' / 'hoa_document_archive.py')
archive = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(archive)


class ArchiveTests(unittest.TestCase):
    def test_archive_bytes_are_verified_before_reuse(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory).resolve() / 'original.pdf'
            archive.preserve(path, b'%PDF-test')
            archive.preserve(path, b'%PDF-test')
            with self.assertRaises(ValueError):
                archive.preserve(path, b'%PDF-different')
            self.assertEqual(path.read_bytes(), b'%PDF-test')

    def test_symlink_is_never_followed(self):
        with tempfile.TemporaryDirectory() as directory:
            target = pathlib.Path(directory).resolve() / 'target'
            target.write_bytes(b'private')
            link = pathlib.Path(directory).resolve() / 'original.pdf'
            link.symlink_to(target)
            with self.assertRaises(ValueError):
                archive.preserve(link, b'private')

    def test_private_archive_cannot_be_inside_a_git_repo(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            (root / '.git').mkdir()
            with self.assertRaises(ValueError):
                archive.validate_destination(root / 'private-docs')

    def test_page_payload_keeps_source_and_untrusted_status(self):
        result = archive.knowledge_page('a' * 64, 2, 'Example.pdf', 'OCR text', 'ocr', 'https://example.com/docs')
        self.assertIn('review_status: unreviewed-source', result['content'])
        self.assertIn('Page 2', result['content'])
        self.assertIn('OCR text', result['content'])
        self.assertIn('a' * 64, result['slug'])


if __name__ == '__main__':
    unittest.main()
