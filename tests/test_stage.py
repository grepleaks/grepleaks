import os
from pathlib import Path
import tempfile
import unittest
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "host"))
from stage import stage


class StageTests(unittest.TestCase):
    def test_regular_files_of_any_type(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            exchange = root / "exchange"
            exchange.mkdir()
            for name in ["sample.exe", "library.dll", "linux-binary", "capture.pcap", "archive.zip", "rapport été.txt"]:
                with self.subTest(name=name):
                    source = root / name
                    source.write_bytes(bytes(range(256)))
                    result = stage(source, exchange)
                    copied = Path(result["host_path"])
                    self.assertEqual(copied.read_bytes(), bytes(range(256)))
                    self.assertEqual(result["container_path"], "/var/lib/grepleaks/exchange/" + copied.parent.name + "/" + name)
                    copied.write_bytes(b"changed")
                    self.assertEqual(source.read_bytes(), bytes(range(256)))

    def test_generic_project_tree_with_spaces_and_unicode(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "Projet été"
            (source / "src").mkdir(parents=True)
            (source / "empty").mkdir()
            (source / "src/main.py").write_bytes(b"print('example')")
            (source / ".config").write_bytes(b"example config")
            exchange = root / "exchange"
            exchange.mkdir()
            result = stage(str(source), str(exchange))
            copy = Path(result["host_path"])
            self.assertEqual((copy / "src/main.py").read_bytes(), b"print('example')")
            self.assertEqual((copy / ".config").read_bytes(), b"example config")
            self.assertTrue((copy / "empty").is_dir())

    def test_bundle_copy_is_independent_and_has_container_path(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "Test App.app"
            (source / "Contents/MacOS").mkdir(parents=True)
            binary = source / "Contents/MacOS/test"
            binary.write_bytes(b"\xcf\xfa\xed\xfe" + b"example")
            exchange = root / "exchange"
            exchange.mkdir()
            result = stage(source, exchange)
            copied = Path(result["host_path"]) / "Contents/MacOS/test"
            self.assertEqual(copied.read_bytes(), binary.read_bytes())
            self.assertTrue(result["container_path"].startswith("/var/lib/grepleaks/exchange/artifact-"))
            copied.write_bytes(b"modified copy")
            self.assertEqual(binary.read_bytes(), b"\xcf\xfa\xed\xfeexample")
            self.assertNotEqual(stage(source, exchange)["host_path"], result["host_path"])

    @unittest.skipIf(os.name == "nt", "Symlink creation needs Windows developer mode or elevation")
    def test_links_are_preserved_without_copying_external_files(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "App.app"
            source.mkdir()
            outside = root / "outside"
            outside.mkdir()
            (outside / "unrelated.txt").write_text("outside artifact")
            (source / "external").symlink_to(outside, target_is_directory=True)
            (source / "broken").symlink_to("missing")
            exchange = root / "exchange"
            exchange.mkdir()
            result = stage(source, exchange)
            copy = Path(result["host_path"])
            self.assertTrue((copy / "external").is_symlink())
            self.assertTrue((copy / "broken").is_symlink())
            self.assertEqual(os.readlink(copy / "external"), str(outside))

    def test_rejects_copying_the_exchange_into_itself(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            exchange = root / "exchange"
            exchange.mkdir()
            for source in [root, exchange]:
                with self.assertRaises(ValueError): stage(source, exchange)
            with self.assertRaises(FileNotFoundError): stage(root / "missing.app", exchange)
            self.assertEqual(list(exchange.iterdir()), [])


if __name__ == "__main__": unittest.main()
