"""Hub recovery demo package.

Everything that computes a number lives here, so the agents and the prompts never
carry scenario values (rules 4 and 5). ``scenario/qr004.yaml`` is the single source
of the numbers and ``tests/`` asserts against its ``expected`` block.
"""

__version__ = "0.1.0"

__all__ = ["__version__"]
