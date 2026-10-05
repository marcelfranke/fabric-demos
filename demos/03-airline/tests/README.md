# tests

Unit tests, live tests and security tests.

Unit tests run offline and assert against the `expected` block of
`scenario/qr004.yaml`. They are the reason a rules change cannot quietly move a
number.

Tests that need cloud resources are marked `@pytest.mark.live` and are skipped
unless `HUBDEMO_LIVE=1`. Tests that exercise a security control are marked
`@pytest.mark.security`.

Run them with `pytest -q`.
