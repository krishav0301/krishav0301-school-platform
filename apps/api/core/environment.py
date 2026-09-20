"""Startup checks on the environment. Imported by settings, so no Django imports here."""

from django.core.exceptions import ImproperlyConfigured

ENVIRONMENTS = {"development", "test", "staging", "production"}


def validate_environment(env_name: str, demo_mode: bool) -> None:
    """Refuse to start in a configuration that could expose demo tooling.

    Demo mode turns on the persona switcher and the reset command. It must
    never be reachable in production.
    """
    if env_name not in ENVIRONMENTS:
        raise ImproperlyConfigured(f"ENV must be one of {sorted(ENVIRONMENTS)}, got {env_name!r}.")
    if demo_mode and env_name == "production":
        raise ImproperlyConfigured("DEMO_MODE must be off when ENV=production.")
