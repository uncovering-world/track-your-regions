"""How cv-python's lines are written: stdlib logging, to stdout, where Docker collects them.

Every module logs through ``logging.getLogger(__name__)``, and this is the one
place that decides how a line looks and which ones are kept. The level comes
from ``CV_LOG_LEVEL`` (default INFO), so a noisy OCR run can be read at WARNING
and a matching run debugged at DEBUG without a rebuild. One handler, to stdout:
the container's log is the collector, as it was for the ``print()`` calls this
replaced (#623). No file handler and no new dependency.

What leaves the service does not change: an error answers the caller with a
generic message, and the full trace is a log line here (`middleware.py`,
`routes/pipeline.py`).
"""

import logging
import os
import sys

DEFAULT_LEVEL = "INFO"


def configure_logging() -> None:
    """Install the stdout handler on the root logger, at the level the environment names."""
    raw = os.environ.get("CV_LOG_LEVEL", "").strip().upper() or DEFAULT_LEVEL
    level = logging.getLevelNamesMapping().get(raw)
    logging.basicConfig(
        level=level if level is not None else logging.INFO,
        stream=sys.stdout,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        force=True,
    )
    if level is None:
        logging.getLogger(__name__).warning("CV_LOG_LEVEL=%r is not a logging level; logging at %s", raw, DEFAULT_LEVEL)
