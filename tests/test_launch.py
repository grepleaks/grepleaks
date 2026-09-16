import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("config", ROOT / "docker/config.py")
config = importlib.util.module_from_spec(spec)
spec.loader.exec_module(config)
launch_spec = importlib.util.spec_from_file_location("launch", ROOT / "scripts/launch.py")
launcher = importlib.util.module_from_spec(launch_spec)
launch_spec.loader.exec_module(launcher)

class SetupTests(unittest.TestCase):
    def test_unconfigured_launch_reaches_tui_without_shell_prompts(self):
        with patch("builtins.input", side_effect=AssertionError("unexpected prompt")):
            launcher.configure({}, True)
            launcher.configure({}, False)
    def test_invalid_config_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "Invalid provider configuration"):
            launcher.configure({"OPENCODE_CONFIG_CONTENT": "[]"}, False)
    def test_complete_config_does_not_prompt(self):
        with patch("builtins.input", side_effect=AssertionError("unexpected prompt")):
            launcher.configure({"OPENCODE_CONFIG_CONTENT": '{"model":"local/model"}'}, True)
            launcher.configure({"GREPLEAKS_API_KEY": "unit", "GREPLEAKS_API_URL": "https://provider.example/v1"}, True)

class ConfigurationTests(unittest.TestCase):
    def test_pentest_persona_is_selected_for_both_standard_modes(self):
        for env in [{"BYOK_API_KEY": "unit", "BYOK_BASE_URL": "https://provider.example/v1", "BYOK_MODEL": "model"}, {"GREPLEAKS_API_KEY": "unit", "GREPLEAKS_API_URL": "https://provider.example/v1"}]:
            result = config.configuration(env)
            self.assertIn("expert penetration tester", result["agent"]["build"]["prompt"])
            self.assertIn("/opt/grepleaks/AGENTS.md", result["instructions"])
            self.assertEqual(result["permission"]["*"], "ask")
    def test_keys_stay_out_of_json(self):
        value = "unit" + "-credential"
        result = config.configuration({"BYOK_API_KEY": value, "BYOK_BASE_URL": "https://provider.example/v1", "BYOK_MODEL": 'model/"quoted'})
        self.assertNotIn(value, json.dumps(result))
        self.assertEqual(result["model"], 'byok/model/"quoted')
        self.assertEqual(result["provider"]["byok"]["options"]["apiKey"], "{env:BYOK_API_KEY}")
        self.assertEqual(result["permission"]["*"], "ask")
    def test_invalid_configuration(self):
        for env in [{"GREPLEAKS_API_KEY": "unit"}, {"OPENCODE_CONFIG_CONTENT": "[]"}, {"OPENCODE_CONFIG_CONTENT": "invalid"}, {"BYOK_API_KEY": "unit", "BYOK_MODEL": "m", "BYOK_BASE_URL": "https://user:pass@provider.example"}]:
            with self.assertRaises(ValueError): config.configuration(env)
    def test_environment_setup_persists_without_key_in_config(self):
        env = {"BYOK_API_KEY": "unit-credential", "BYOK_BASE_URL": "https://provider.example/v1", "BYOK_MODEL": "first"}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            runtime = config.persist_provider(config.configuration(env), env, root)
            self.assertNotIn("provider", runtime)
            self.assertNotIn("model", runtime)
            settings = root / "config/opencode/opencode.json"
            auth = root / "data/opencode/auth.json"
            self.assertNotIn("unit-credential", settings.read_text())
            self.assertEqual(json.loads(auth.read_text())["byok"]["key"], "unit-credential")
            if os.name != "nt": self.assertEqual(auth.stat().st_mode & 0o777, 0o600)
            env["BYOK_MODEL"] = "second"
            config.persist_provider(config.configuration(env), env, root)
            saved = json.loads(settings.read_text())
            self.assertEqual(set(saved["provider"]["byok"]["models"]), {"first", "second"})
            self.assertEqual(saved["model"], "byok/second")
            config.persist_provider(config.configuration({}), {}, root)
            self.assertEqual(json.loads(settings.read_text()), saved)
    def test_advanced_override(self):
        self.assertEqual(config.configuration({"OPENCODE_CONFIG_CONTENT": '{"model":"local/model"}'}), {"model": "local/model"})
    def test_host_bridge_with_advanced_configuration(self):
        env = {"OPENCODE_CONFIG_CONTENT": '{"model":"local/model","plugin":["existing-plugin"]}', "GREPLEAKS_HOST_TOKEN": "unit"}
        result = config.configuration(env)
        self.assertEqual(result["plugin"], ["existing-plugin", "/opt/grepleaks/engine/packages/opencode/src/plugin/grepleaks-host.ts"])
        env["OPENCODE_CONFIG_CONTENT"] = json.dumps(result)
        self.assertEqual(config.configuration(env), result)

@unittest.skipIf(os.name == "nt", "This integration fixture uses a Unix executable; Windows uses grepleaks.cmd")
class LauncherTests(unittest.TestCase):
    def launch(self, *args, extra=None):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            docker = path / "docker"
            docker.write_text('#!/usr/bin/env python3\nimport sys,json\nif sys.argv[1:2] == ["run"]: print(json.dumps(sys.argv[1:]))\n')
            docker.chmod(0o755)
            env = {k: v for k, v in os.environ.items() if not k.startswith(("BYOK_", "GREPLEAKS_", "OPENCODE_", "NANO_"))}
            env.update({"PATH": str(path) + os.pathsep + env["PATH"], "HOME": directory})
            env.update({"BYOK_API_KEY": "unit-credential", "BYOK_BASE_URL": "https://provider.example/v1", "BYOK_MODEL": "unit-model"})
            env.update(extra or {})
            return subprocess.run(["bash", str(ROOT / "grepleaks"), *args], env=env, text=True, capture_output=True)
    def test_missing_config_starts_docker_for_tui_setup(self):
        result = self.launch(extra={"BYOK_API_KEY": "", "BYOK_BASE_URL": "", "BYOK_MODEL": ""})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("grepleaks:local", json.loads(result.stdout))
    def test_no_implicit_host_mount_or_secret_in_argv(self):
        secret = "unit" + "-credential"
        result = self.launch(extra={"BYOK_API_KEY": secret})
        self.assertEqual(result.returncode, 0, result.stderr)
        args = json.loads(result.stdout)
        self.assertIn("BYOK_API_KEY", args)
        self.assertNotIn(secret, result.stdout)
        mounts = [args[i+1] for i, value in enumerate(args) if value == "--mount"]
        self.assertEqual(len(mounts), 2)
        self.assertIn("dst=/var/lib/grepleaks", mounts[0])
        self.assertTrue(mounts[1].endswith("/.grepleaks/state/workspace,dst=/engagement"))
        self.assertNotIn("--privileged", args)
    def test_companion_is_enabled_by_default_and_can_be_disabled(self):
        result = self.launch()
        self.assertEqual(result.returncode, 0, result.stderr)
        args = json.loads(result.stdout)
        self.assertIn("GREPLEAKS_HOST_TOKEN", args)
        self.assertIn("127.0.0.1::8788", args)
        self.assertIn("--name", args)
        disabled = self.launch("--no-host-bridge", extra={"GREPLEAKS_HOST_TOKEN": "stale-token"})
        self.assertEqual(disabled.returncode, 0, disabled.stderr)
        self.assertNotIn("GREPLEAKS_HOST_TOKEN", json.loads(disabled.stdout))
        self.assertNotIn("127.0.0.1::8788", json.loads(disabled.stdout))
        version = self.launch("--version")
        self.assertNotIn("GREPLEAKS_HOST_TOKEN", json.loads(version.stdout))

    def test_host_access_is_explicit(self):
        result = self.launch("--host-access")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(any("dst=/host" in arg for arg in json.loads(result.stdout)))
        self.assertIn("READ-WRITE", result.stderr)
    def test_workspace_with_spaces(self):
        with tempfile.TemporaryDirectory(prefix="workspace ") as directory:
            result = self.launch("--workspace", directory)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue(any(directory in arg and "dst=/engagement" in arg for arg in json.loads(result.stdout)))
        self.assertNotEqual(self.launch("--workspace", directory).returncode, 0)
    def test_server_auth_and_loopback(self):
        self.assertNotEqual(self.launch("serve").returncode, 0)
        result = self.launch("serve", extra={"OPENCODE_SERVER_PASSWORD": "unit"})
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("127.0.0.1:4096:4096", json.loads(result.stdout))
        self.assertNotIn("unit", result.stdout)
    def test_dev_source_paths(self):
        result = self.launch("--dev", "run", "offline sample")
        self.assertEqual(result.returncode, 0, result.stderr)
        args = json.loads(result.stdout)
        self.assertTrue(any("dst=/opt/grepleaks/engine/packages/tui/src,readonly" in arg for arg in args))
        self.assertEqual(args[-2:], ["run", "offline sample"])
    def test_engine_flags_are_forwarded(self):
        for flags in [("-s", "ses_example"), ("--model", "byok/my-model", "--agent", "build"), ("--continue",)]:
            result = self.launch(*flags)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)[-len(flags):], list(flags))

if __name__ == "__main__": unittest.main()
