import pytest
import os
from dotenv import load_dotenv
from openai import OpenAI
from utils.download_assets import download_if_missing

@pytest.fixture(scope="session", autouse=True)
def setup_assets():
    """Ensure assets are downloaded before any tests run."""
    # This points to the tests folder relative to this file
    tests_dir = os.path.dirname(__file__)
    properties_path = os.path.join(tests_dir, "binaries.properties")
    download_if_missing(properties_path, tests_dir)

@pytest.fixture(scope="session")
def client():
    load_dotenv()
    api_key = os.getenv("OPENROUTER_API_KEY")
    return OpenAI(base_url="https://openrouter.ai/api/v1", api_key=api_key)

@pytest.fixture
def test_dir():
    """Returns the absolute path to the tests directory."""
    return os.path.dirname(__file__)