"""cv-python's lines go through stdlib logging, to stdout, at the level the environment names (#623)."""

import logging

import pytest

from app.logging_config import configure_logging


@pytest.fixture(autouse=True)
def _restore_root_logger():
    root = logging.getLogger()
    handlers, level = root.handlers[:], root.level
    yield
    root.handlers[:] = handlers
    root.setLevel(level)


def test_logs_at_info_to_stdout_by_default(monkeypatch, capsys):
    monkeypatch.delenv("CV_LOG_LEVEL", raising=False)
    configure_logging()

    logging.getLogger("app.cv.match").info("[RANSAC] Init: sx=1.0")
    logging.getLogger("app.cv.match").debug("[RANSAC] not shown")

    out = capsys.readouterr().out
    assert "INFO app.cv.match: [RANSAC] Init: sx=1.0" in out
    assert "not shown" not in out


def test_takes_the_level_the_environment_names(monkeypatch, capsys):
    monkeypatch.setenv("CV_LOG_LEVEL", "warning")
    configure_logging()

    logging.getLogger("app.cv.text_detection").info("[OCR] Detected 3 text regions")
    logging.getLogger("app.cv.match").warning("[Proj] lcc failed: no convergence")

    out = capsys.readouterr().out
    assert "[OCR]" not in out
    assert "WARNING app.cv.match: [Proj] lcc failed" in out


def test_a_level_that_is_not_one_falls_back_to_info_and_says_so(monkeypatch, capsys):
    monkeypatch.setenv("CV_LOG_LEVEL", "LOUD")
    configure_logging()

    assert logging.getLogger().level == logging.INFO
    assert "CV_LOG_LEVEL='LOUD' is not a logging level" in capsys.readouterr().out


def test_a_failed_worker_keeps_its_trace_in_the_log(monkeypatch, capsys):
    # The trace is the operator's, on stdout. The caller's NDJSON error stays
    # generic (routes/pipeline.py), and that path is unchanged by the swap.
    monkeypatch.delenv("CV_LOG_LEVEL", raising=False)
    configure_logging()
    try:
        raise ValueError("bad affine")
    except ValueError:
        logging.getLogger("app.routes.pipeline").exception("Pipeline worker failed")

    out = capsys.readouterr().out
    assert "ERROR app.routes.pipeline: Pipeline worker failed" in out
    assert "ValueError: bad affine" in out
