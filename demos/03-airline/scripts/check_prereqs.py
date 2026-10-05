#!/usr/bin/env python
"""Check that this machine can build and run the demo.

Four checks:

1. Python version — the kit targets 3.11, the Fabric user data functions runtime.
2. Azure CLI signed in — ``az account show``.
3. Fabric CLI installed — ``fab --version``.
4. Environment file complete — ``config/env.<name>.yaml`` has a value for every
   required key.

Usage::

    python scripts/check_prereqs.py --env demo
    python scripts/check_prereqs.py --env example --dry-run

``--dry-run`` runs no external command. It reports which ones it would run and
still reads the environment file, so it is the safe way to see what is missing
before anything is signed in. Exits non-zero when any check fails, so it works in
a pipeline. Running it twice changes nothing.
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

# Allow running straight from a clone, before "pip install -e .".
if str(REPO_ROOT / "src") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "src"))

from hubdemo.config import (  # noqa: E402  (import after the sys.path fallback)
    REQUIRED_KEYS,
    ConfigError,
    config_path,
    missing_keys,
    read_config,
)

REQUIRED_PYTHON = (3, 11)
COMMAND_TIMEOUT_SECONDS = 60

PASS = "ok"
FAIL = "missing"
SKIP = "skipped"


class Result:
    """One check and what it found."""

    def __init__(self, name: str, state: str, detail: str) -> None:
        self.name = name
        self.state = state
        self.detail = detail

    @property
    def failed(self) -> bool:
        return self.state == FAIL

    def __str__(self) -> str:
        return f"[{self.state:>7}] {self.name}: {self.detail}"


def _run(command: list[str]) -> tuple[int, str]:
    """Run a command and return its exit code and the last line of its output."""
    try:
        completed = subprocess.run(  # noqa: S603  (fixed argument lists, no shell)
            command,
            capture_output=True,
            text=True,
            timeout=COMMAND_TIMEOUT_SECONDS,
            check=False,
        )
    except FileNotFoundError:
        return 127, f"{command[0]} not found on PATH"
    except subprocess.TimeoutExpired:
        return 124, f"{command[0]} did not answer within {COMMAND_TIMEOUT_SECONDS} seconds"
    output = (completed.stdout or completed.stderr or "").strip()
    last_line = output.splitlines()[-1] if output else ""
    return completed.returncode, last_line


def check_python() -> Result:
    found = sys.version_info
    wanted = ".".join(str(part) for part in REQUIRED_PYTHON)
    running = f"{found.major}.{found.minor}.{found.micro}"
    if (found.major, found.minor) == REQUIRED_PYTHON:
        return Result("python", PASS, f"{running}")
    return Result(
        "python",
        FAIL,
        f"running {running}, the kit targets {wanted} because that is the Fabric "
        "user data functions runtime",
    )


def check_azure_cli(dry_run: bool) -> Result:
    # https://learn.microsoft.com/en-us/cli/azure/account#az-account-show
    command = ["az", "account", "show", "--output", "none"]
    if dry_run:
        return Result("azure cli", SKIP, f"dry run, would call: {' '.join(command)}")
    if shutil.which("az") is None:
        return Result(
            "azure cli",
            FAIL,
            "az not found on PATH. Install the Azure CLI, then run: az login",
        )
    code, detail = _run(command)
    if code == 0:
        return Result("azure cli", PASS, "signed in")
    return Result("azure cli", FAIL, f"az account show failed. Run: az login. {detail}".strip())


def check_fabric_cli(dry_run: bool) -> Result:
    # https://learn.microsoft.com/en-us/rest/api/fabric/articles/fabric-command-line-interface
    command = ["fab", "--version"]
    if dry_run:
        return Result("fabric cli", SKIP, f"dry run, would call: {' '.join(command)}")
    if shutil.which("fab") is None:
        return Result(
            "fabric cli",
            FAIL,
            "fab not found on PATH. Install it: pip install ms-fabric-cli",
        )
    code, detail = _run(command)
    if code == 0:
        return Result("fabric cli", PASS, detail or "installed")
    return Result("fabric cli", FAIL, f"fab --version failed. {detail}".strip())


def check_config(env: str) -> tuple[Result, list[str]]:
    path = config_path(env)
    try:
        values = read_config(env)
    except ConfigError as exc:
        return Result("config", FAIL, str(exc)), list(REQUIRED_KEYS)
    missing = missing_keys(values)
    have = len(REQUIRED_KEYS) - len(missing)
    total = len(REQUIRED_KEYS)
    if not missing:
        return Result("config", PASS, f"{path} is complete, {have} of {total} keys"), []
    return (
        Result("config", FAIL, f"{path} has {len(missing)} of {total} keys with no value"),
        missing,
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--env",
        default="demo",
        help="Reads config/env.<name>.yaml. Use example to check the template.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run no external command. Report what would run and read the environment file.",
    )
    args = parser.parse_args(argv)

    print(f"checking prerequisites for env '{args.env}'" + (" (dry run)" if args.dry_run else ""))
    print()

    config_result, missing = check_config(args.env)
    results = [
        check_python(),
        check_azure_cli(args.dry_run),
        check_fabric_cli(args.dry_run),
        config_result,
    ]

    for result in results:
        print(result)

    if missing:
        print()
        print(f"empty configuration keys ({len(missing)}):")
        for key in missing:
            print(f"  - {key}")
        if args.env == "example":
            print()
            print(
                "config/env.example.yaml is the template, so every key being empty is expected. "
                "Copy it to config/env.demo.yaml and fill it in."
            )

    failures = [result for result in results if result.failed]
    print()
    if failures:
        print(f"not ready: {len(failures)} of {len(results)} checks failed")
        return 1
    print(f"ready: {len(results)} checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
