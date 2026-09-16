import json
import os
from pathlib import Path
import secrets
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "host"))
from bridge import Broker, execute, request, worker

class HostBridgeTests(unittest.TestCase):
    def test_execute_real_process_and_bound_output(self):
        with tempfile.TemporaryDirectory() as directory:
            result = execute({"argv": [sys.executable, "-c", "import platform; print(platform.system())"]}, directory, threading.Event())
            self.assertEqual(result["exit_code"], 0)
            self.assertTrue(result["output"].strip())
            result = execute({"argv": [sys.executable, "-c", "import time; time.sleep(10)"], "timeout": 1}, directory, threading.Event())
            self.assertEqual(result["stopped"], "timeout")
            result = execute({"argv": [sys.executable, "-c", "print('x' * 100000)"]}, directory, threading.Event())
            self.assertLessEqual(len(result["output"].encode()), 65536)
    def test_no_implicit_shell(self):
        with tempfile.TemporaryDirectory() as directory:
            result = execute({"argv": [sys.executable, "-c", "import sys; print(sys.argv[1])", "; echo SHOULD_NOT_EXECUTE"]}, directory, threading.Event())
            self.assertEqual(result["output"].strip(), "; echo SHOULD_NOT_EXECUTE")
    def test_child_does_not_inherit_pairing_token(self):
        previous = os.environ.get("GREPLEAKS_HOST_TOKEN")
        os.environ["GREPLEAKS_HOST_TOKEN"] = secrets.token_urlsafe(32)
        try:
            result = execute({"argv": [sys.executable, "-c", "import os; print('GREPLEAKS_HOST_TOKEN' in os.environ)"]}, Path.cwd(), threading.Event())
            self.assertEqual(result["output"].strip(), "False")
        finally:
            if previous is None: os.environ.pop("GREPLEAKS_HOST_TOKEN", None)
            else: os.environ["GREPLEAKS_HOST_TOKEN"] = previous
    def test_authenticated_pairing_and_round_trip(self):
        token = secrets.token_urlsafe(32)
        broker = Broker(("127.0.0.1", 0), token)
        server = threading.Thread(target=broker.serve_forever, daemon=True)
        server.start()
        stop = threading.Event()
        url = f"http://127.0.0.1:{broker.server_port}"
        companion = threading.Thread(target=worker, args=(url, token, Path.cwd(), stop), daemon=True)
        try:
            with self.assertRaises(urllib.error.HTTPError) as error:
                request(url, "wrong", "/info", {})
            self.assertEqual(error.exception.code, 401)
            self.assertFalse(request(url, token, "/info", {})["connected"])
            companion.start()
            for _ in range(40):
                if request(url, token, "/info", {})["connected"]: break
                time.sleep(0.05)
            info = request(url, token, "/info", {})
            self.assertTrue(info["connected"])
            self.assertIn(info["host"]["os"], ("Darwin", "Windows", "Linux"))
            result = request(url, token, "/request", {"argv": [sys.executable, "-c", "print('bridge-ready')"]})
            self.assertEqual(result["output"].strip(), "bridge-ready")
            self.assertEqual(result["exit_code"], 0)
            with self.assertRaises(urllib.error.HTTPError) as error:
                request(url, token, "/request", {"argv": "shell string"})
            self.assertEqual(error.exception.code, 400)
        finally:
            stop.set()
            if companion.ident: companion.join(timeout=3)
            broker.shutdown()
            broker.server_close()
            server.join(timeout=3)

if __name__ == "__main__": unittest.main()
