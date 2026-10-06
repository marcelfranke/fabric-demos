"""Command line entry point for the kit.

The commands here need no cloud: report the version, report the state of an
environment file, describe the scenario file, and write the data dictionary.
Later phases add the rules and run commands.
"""

from __future__ import annotations

import typer

from hubdemo import __version__
from hubdemo.config import (
    REQUIRED_KEYS,
    ConfigError,
    config_path,
    missing_keys,
    read_config,
    repo_root,
)
from hubdemo.models import data_dictionary_markdown
from hubdemo.scenario import (
    DEFAULT_SCENARIO,
    ScenarioError,
    at_risk_ids,
    load_scenario,
    scenario_path,
    totals,
    windows,
)

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


@app.command("describe")
def describe_command(
    scenario: str = typer.Option(
        DEFAULT_SCENARIO,
        "--scenario",
        help="Path to the scenario file.",
    ),
) -> None:
    """Print the totals and the connection window per onward flight."""
    try:
        data = load_scenario(scenario)
    except ScenarioError as exc:
        typer.echo(str(exc))
        raise typer.Exit(code=1) from exc

    counts = totals(data)
    minutes = windows(data)
    at_risk = set(at_risk_ids(data))

    typer.echo(f"file: {scenario_path(scenario)}")
    typer.echo(f"scenario: {data.scenario_id}")
    typer.echo(
        f"inbound {data.inbound.flight_no} from {data.inbound.origin_city}, "
        f"new eta {data.inbound.new_eta_local:%H:%M}"
    )
    typer.echo(
        f"{counts['onward_flights']} onward flights, "
        f"{counts['connecting_pax']} connecting passengers, "
        f"{counts['transfer_bags']} transfer bags, "
        f"{counts['connecting_members']} members and "
        f"{counts['cargo_shipments']} shipments"
    )
    typer.echo("")
    typer.echo("windows per onward flight:")
    for onward in data.onward_flights:
        mark = "  at risk" if onward.id in at_risk else ""
        typer.echo(
            f"  {onward.id:<4} {onward.flight_no:<8} {onward.city:<16} "
            f"departs {onward.std_local:%H:%M}  "
            f"window {minutes[onward.id]:>3} min{mark}"
        )
    if at_risk:
        typer.echo("")
        typer.echo(
            f"at risk below the standard of {data.rules.pax_standard_min} minutes: "
            f"{', '.join(at_risk_ids(data))}"
        )


@app.command("docs")
def docs_command() -> None:
    """Write docs/data-dictionary.md from the row models."""
    target = repo_root() / "docs" / "data-dictionary.md"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(data_dictionary_markdown(), encoding="utf-8")
    typer.echo(f"wrote {target}")


def main() -> None:
    """Console script entry point."""
    app()


if __name__ == "__main__":
    main()
