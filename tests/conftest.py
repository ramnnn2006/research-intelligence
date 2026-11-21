"""Private ephemeral access credentials for isolated test runs only."""
import os
import secrets
import pytest


@pytest.fixture(scope="session", autouse=True)
def private_test_access():
    previous = os.environ.get("API_AUTH_TOKEN")
    if previous is None:
        os.environ["API_AUTH_TOKEN"] = secrets.token_urlsafe(36)
    yield
    if previous is None:
        os.environ.pop("API_AUTH_TOKEN", None)
