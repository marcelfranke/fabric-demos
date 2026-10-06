"""Environment configuration.

Values live in ``config/env.<name>.yaml``. The files hold names and identifiers
only. There are no secrets in them and none belong there: Azure access comes from
``DefaultAzureCredential`` after ``az login`` (rule 6).

A key counts as missing when it is absent from the file, or present with no value.
``config/env.example.yaml`` is the template and therefore has every key empty, so
``load_config("example")`` reports all nineteen as missing. That is the expected
result and is what ``scripts/check_prereqs.py`` prints.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml

# The nineteen keys every environment file must carry, in file order.
REQUIRED_KEYS: tuple[str, ...] = (
    "tenant_id",
    "subscription_id",
    "location",
    "resource_group",
    "fabric.capacity_name",
    "fabric.workspace_name",
    "foundry.resource_name",
    "foundry.project_name",
    "foundry.model_deployment",
    "foundry.price_in_per_million",
    "foundry.price_out_per_million",
    "people.duty_manager_upn",
    "people.ops_control_manager_upn",
    "people.gate_agent_upn",
    "people.builder_upn",
    "teams.team_id",
    "teams.channel_id",
    "sentinel.workspace_name",
    "purview.label_name",
)


class ConfigError(RuntimeError):
    """Raised when an environment file is absent, unreadable or incomplete."""


def repo_root() -> Path:
    """Return the kit root, the folder that holds ``config/`` and ``scenario/``.

    Set ``HUBDEMO_ROOT`` to override, which is what you need when the package is
    installed somewhere other than next to the kit.
    """
    override = os.environ.get("HUBDEMO_ROOT")
    if override:
        return Path(override).expanduser().resolve()
    # src/hubdemo/config.py -> src/hubdemo -> src -> kit root
    return Path(__file__).resolve().parents[2]


def config_path(env: str) -> Path:
    """Return the path of ``config/env.<env>.yaml``."""
    return repo_root() / "config" / f"env.{env}.yaml"


def _flatten(data: Any, prefix: str = "") -> dict[str, Any]:
    """Turn nested mappings into dotted keys, leaving every other value alone."""
    flat: dict[str, Any] = {}
    if not isinstance(data, dict):
        return flat
    for key, value in data.items():
        dotted = f"{prefix}{key}"
        if isinstance(value, dict):
            flat.update(_flatten(value, prefix=f"{dotted}."))
        else:
            flat[dotted] = value
    return flat


def _is_empty(value: Any) -> bool:
    if value is None:
        return True
    return isinstance(value, str) and not value.strip()


def missing_keys(values: dict[str, Any]) -> list[str]:
    """Return the required keys that are absent or empty, in file order."""
    return [key for key in REQUIRED_KEYS if _is_empty(values.get(key))]


def read_config(env: str) -> dict[str, Any]:
    """Read ``config/env.<env>.yaml`` and return it flattened to dotted keys.

    Does not check for missing keys. Use :func:`missing_keys` for that, or
    :func:`load_config` when the caller cannot continue without them.
    """
    path = config_path(env)
    if not path.is_file():
        raise ConfigError(
            f"No environment file at {path}. "
            f"Copy config/env.example.yaml to config/env.{env}.yaml and fill it in."
        )
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise ConfigError(f"{path} is not valid YAML: {exc}") from exc
    if raw is None:
        raw = {}
    if not isinstance(raw, dict):
        raise ConfigError(
            f"{path} must contain a mapping at the top level, "
            f"found {type(raw).__name__}."
        )
    return _flatten(raw)


def load_config(env: str, *, require: bool = True) -> dict[str, Any]:
    """Load an environment file.

    With ``require=True`` an incomplete file raises :class:`ConfigError` naming
    every key that still needs a value.
    """
    values = read_config(env)
    if require:
        missing = missing_keys(values)
        if missing:
            listed = "\n".join(f"  - {key}" for key in missing)
            raise ConfigError(
                f"{config_path(env)} is incomplete. "
                f"{len(missing)} of {len(REQUIRED_KEYS)} required keys have no value:\n{listed}\n"
                "Fill them in, then run: python scripts/check_prereqs.py "
                f"--env {env}"
            )
    return values


def get(values: dict[str, Any], key: str) -> Any:
    """Return one configuration value, failing clearly when it has none."""
    if key not in REQUIRED_KEYS:
        raise ConfigError(
            f"{key} is not a known configuration key. "
            f"Known keys: {', '.join(REQUIRED_KEYS)}"
        )
    value = values.get(key)
    if _is_empty(value):
        raise ConfigError(f"Configuration key {key} has no value.")
    return value


def get_optional(values: dict[str, Any], key: str, default: Any = "") -> Any:
    """Return one configuration value, or ``default`` when it is absent or empty.

    Use this on dry run and plan paths, where the example environment file is
    empty on purpose and the script must still print what it would do. Use
    :func:`get` on live paths, where an empty value must fail loudly before any
    network call is made.
    """
    if key not in REQUIRED_KEYS:
        raise ConfigError(
            f"{key} is not a known configuration key. "
            f"Known keys: {', '.join(REQUIRED_KEYS)}"
        )
    value = values.get(key)
    return default if _is_empty(value) else value
