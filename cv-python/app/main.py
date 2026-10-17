import cv2
import skimage
from fastapi import FastAPI

from .logging_config import configure_logging
from .middleware import install_security_middleware
from .routes.pipeline import router as pipeline_router

configure_logging()

# No CORSMiddleware: this service is called only from the backend over the internal
# Docker network. It must never be exposed to browser origins directly.

app = FastAPI(title="Track Your Regions — CV Service")

# ASVS L2: body-size cap (V4.1.1 / V5.1.1) and sanitised exception responses
# (V13.4). See app/middleware.py for the rationale.
install_security_middleware(app)

app.include_router(pipeline_router)


@app.get("/health")
async def health() -> dict[str, str]:
    return {
        "status": "ok",
        "opencv": cv2.__version__,
        # Read by name: scikit-image's stubs leave `__version__` undeclared.
        "scikit_image": getattr(skimage, "__version__", "unknown"),
    }
