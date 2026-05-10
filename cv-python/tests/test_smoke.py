from fastapi import FastAPI


def test_app_imports() -> None:
    """The FastAPI app must import cleanly. This is the floor for CI greenness."""
    from app.main import app

    assert isinstance(app, FastAPI)
