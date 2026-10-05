"""Command line entry point for the kit.

Phase 0 ships the two commands that need no cloud: report the version and report
the state of an environment file. Later phases add the scenario, rules and run
commands here.
"""

from __future__ import annotations

import typer

from hubdemo import __version__
from hubdemo.config import REQUIRED_KEYS, ConfigError, config_path, missing_keys, read_config

app = typer.Typer(add_completion=False, help="Hub recovery demo.")


@app.command()
def version() -> None:
    """Print the package version."""
    typer.echo(__version__)


@app.command("config")
def config_command(
    env: str = typer.Option("example", "--env", help="Reads config/env.<name>.yaml."),
) -> None:
    """Report whether an environment file is complete."""
    try:
        values = read_config(env)
    except ConfigError as exc:
        typer.echo(str(exc))
        raise typer.Exit(code=1) from exc

    missing = missing_keys(values)
    typer.echo(f"file: {config_path(env)}")
    typer.echo(f"keys with a value: {len(REQUIRED_KEYS) - len(missing)} of {len(REQUIRED_KEYS)}")
    if missing:
        typer.echo("empty keys:")
        for key in missing:
            typer.echo(f"  - {key}")
        raise typer.Exit(code=1)
    typer.echo("complete")


def main() -> None:
    """Console script entry point."""
    app()


if __name__ == "__main__":
    main()
