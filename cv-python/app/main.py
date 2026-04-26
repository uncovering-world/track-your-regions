import cv2
import skimage
from fastapi import FastAPI

from .routes.pipeline import router as pipeline_router

# No CORSMiddleware: this service is called only from the backend over the internal
# Docker network. It must never be exposed to browser origins directly.

app = FastAPI(title="Track Your Regions — CV Service")

app.include_router(pipeline_router)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "opencv": cv2.__version__,
        "scikit_image": skimage.__version__,
    }
