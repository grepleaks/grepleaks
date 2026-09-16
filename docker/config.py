#!/usr/bin/env python3
"""Build a private runtime config. API keys remain environment references."""
import json
import os
import tempfile
from pathlib import Path
from urllib.parse import urlsplit


def configuration(env):
    if env.get("OPENCODE_CONFIG_CONTENT"):
        result = json.loads(env["OPENCODE_CONFIG_CONTENT"])
        if not isinstance(result, dict):
            raise ValueError("OPENCODE_CONFIG_CONTENT must be a JSON object")
        if env.get("GREPLEAKS_HOST_TOKEN"):
            plugins = result.setdefault("plugin", [])
            if not isinstance(plugins, list):
                raise ValueError("plugin must be a list")
            bridge = "/opt/grepleaks/engine/packages/opencode/src/plugin/grepleaks-host.ts"
            if bridge not in plugins:
                plugins.append(bridge)
        return result
    if not any(env.get(key) for key in ("GREPLEAKS_API_KEY", "BYOK_API_KEY", "BYOK_BASE_URL", "BYOK_MODEL")):
        result = base_configuration()
        if env.get("GREPLEAKS_HOST_TOKEN"):
            result["plugin"] = ["/opt/grepleaks/engine/packages/opencode/src/plugin/grepleaks-host.ts"]
        return result
    managed = bool(env.get("GREPLEAKS_API_KEY"))
    prefix = "GREPLEAKS" if managed else "BYOK"
    required = ["GREPLEAKS_API_KEY", "GREPLEAKS_API_URL"] if managed else ["BYOK_API_KEY", "BYOK_BASE_URL", "BYOK_MODEL"]
    missing = [name for name in required if not env.get(name)]
    if missing:
        raise ValueError("Set " + ", ".join(missing))
    endpoint = env["GREPLEAKS_API_URL" if managed else "BYOK_BASE_URL"]
    parsed = urlsplit(endpoint)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("Provider endpoint must be an HTTP(S) URL without embedded credentials")
    provider = "grepleaks" if managed else "byok"
    model = "basilisk-1" if managed else env["BYOK_MODEL"]
    result = {
        "$schema": "https://opencode.ai/config.json",
        "model": f"{provider}/{model}",
        # Override the provider's coding-assistant persona for the main agent.
        # Detailed operational instructions remain in the shared instructions file.
        "agent": {"build": {"prompt": "You are Grepleaks, an expert penetration tester and cybersecurity analyst working with an authorized operator. Follow the Grepleaks mission, tool lifecycle and action-explanation instructions supplied in the system context."}},
        "provider": {provider: {
            "npm": "@ai-sdk/openai-compatible",
            "name": "Grepleaks" if managed else env.get("BYOK_PROVIDER_NAME", "BYOK"),
            "options": {"baseURL": endpoint, "apiKey": "{env:" + prefix + "_API_KEY}"},
            "models": {model: {"name": model}},
        }},
        "permission": {"*": "ask", "read": "allow", "glob": "allow", "grep": "allow", "list": "allow", "skill": "allow", "question": "allow"},
        "skills": {"paths": ["/opt/grepleaks/skills"]},
        "instructions": ["/opt/grepleaks/AGENTS.md"],
    }
    if env.get("GREPLEAKS_HOST_TOKEN"):
        result["plugin"] = ["/opt/grepleaks/engine/packages/opencode/src/plugin/grepleaks-host.ts"]
    return result


def base_configuration():
    return {
        "$schema": "https://opencode.ai/config.json",
        "disabled_providers": ["opencode", "opencode-go"],
        "agent": {"build": {"prompt": "You are Grepleaks, an expert penetration tester and cybersecurity analyst working with an authorized operator. Follow the Grepleaks mission, tool lifecycle and action-explanation instructions supplied in the system context."}},
        "permission": {"*": "ask", "read": "allow", "glob": "allow", "grep": "allow", "list": "allow", "skill": "allow", "question": "allow"},
        "skills": {"paths": ["/opt/grepleaks/skills"]},
        "instructions": ["/opt/grepleaks/AGENTS.md"],
    }


def persist_provider(config, env, root):
    """Import explicit environment setup into the user's private engine store."""
    settings = root / "config/opencode/opencode.json"
    settings.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if not settings.exists() and not settings.with_suffix(".jsonc").exists():
        descriptor = os.open(settings, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "w") as stream:
            json.dump({"$schema": "https://opencode.ai/config.json"}, stream)
    if env.get("OPENCODE_CONFIG_CONTENT") or not config.get("provider"):
        return config
    provider = "grepleaks" if env.get("GREPLEAKS_API_KEY") else "byok"
    key = env["GREPLEAKS_API_KEY" if provider == "grepleaks" else "BYOK_API_KEY"]
    auth = root / "data/opencode/auth.json"
    def read(path):
        value = json.loads(path.read_text()) if path.exists() else {}
        if not isinstance(value, dict): raise ValueError("Invalid saved configuration")
        return value
    def write(path, value):
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(mode="w", dir=path.parent, delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(value, stream)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(path)
    saved = read(settings)
    definition = json.loads(json.dumps(config["provider"][provider]))
    definition["options"].pop("apiKey", None)
    previous = saved.setdefault("provider", {}).get(provider, {})
    definition["models"] = {**previous.get("models", {}), **definition["models"]}
    saved["provider"][provider] = definition
    saved["model"] = config["model"]
    credentials = read(auth)
    credentials[provider] = {"type": "api", "key": key}
    write(auth, credentials)
    write(settings, saved)
    return {**base_configuration(), **{k: v for k, v in config.items() if k not in ("model", "provider")}}


if __name__ == "__main__":
    import sys
    try:
        config = persist_provider(configuration(os.environ), os.environ, Path("/var/lib/grepleaks"))
    except (ValueError, KeyError):
        # Do not echo malformed config/URL values: they may include credentials.
        print("Grepleaks: invalid configuration. Set BYOK_API_KEY, BYOK_BASE_URL and BYOK_MODEL, or a valid advanced configuration. Managed mode also requires GREPLEAKS_API_URL.", file=sys.stderr)
        sys.exit(1)
    path = Path("/run/grepleaks/config.json")
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        json.dump(config, stream)
