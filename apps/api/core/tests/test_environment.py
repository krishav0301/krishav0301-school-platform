import pytest
from django.core.exceptions import ImproperlyConfigured

from core.environment import validate_environment


def test_demo_mode_is_refused_in_production():
    with pytest.raises(ImproperlyConfigured):
        validate_environment("production", demo_mode=True)


@pytest.mark.parametrize("env_name", ["development", "test", "staging"])
def test_demo_mode_is_allowed_outside_production(env_name):
    validate_environment(env_name, demo_mode=True)


def test_production_without_demo_mode_is_fine():
    validate_environment("production", demo_mode=False)


def test_unknown_environment_is_refused():
    with pytest.raises(ImproperlyConfigured):
        validate_environment("prod", demo_mode=False)
