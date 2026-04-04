import json
from fastapi import APIRouter, File, Form, UploadFile
from ..cv.preprocess import run_phase1
from ..utils.image import decode_image

router = APIRouter(prefix="/pipeline", tags=["pipeline"])


@router.post("/phase1")
async def phase1(
    image: UploadFile = File(...),
    params: str = Form(...),
):
    """Phase 1: Preprocess image + detect water."""
    cfg = json.loads(params)
    image_bytes = await image.read()
    img = decode_image(image_bytes)

    result = run_phase1(
        image=img,
        tw=cfg["tw"],
        th=cfg["th"],
        orig_w=cfg["origW"],
        orig_h=cfg["origH"],
    )
    return result
