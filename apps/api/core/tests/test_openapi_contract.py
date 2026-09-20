"""The committed OpenAPI contract must match what the code generates.

The web app's typed client is generated from openapi.yml. If this fails, run:
    uv run python manage.py spectacular --file openapi.yml --validate
then, in apps/web:  npm run gen:api
"""

from pathlib import Path

from django.core.management import call_command

CONTRACT = Path(__file__).resolve().parents[2] / "openapi.yml"


def test_committed_openapi_contract_is_current(tmp_path):
    generated = tmp_path / "openapi.yml"

    call_command("spectacular", file=str(generated), validate=True)

    assert generated.read_text(encoding="utf-8").replace("\r\n", "\n") == CONTRACT.read_text(
        encoding="utf-8"
    ).replace("\r\n", "\n")
