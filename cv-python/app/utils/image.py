import base64
import cv2
import numpy as np


def decode_image(image_bytes: bytes) -> np.ndarray:
    """Decode raw image bytes to BGR numpy array."""
    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    return cv2.imdecode(arr, cv2.IMREAD_COLOR)


def encode_png_base64(image: np.ndarray) -> str:
    """Encode numpy array to base64 PNG data URL."""
    _, buf = cv2.imencode(".png", image)
    b64 = base64.b64encode(buf.tobytes()).decode("ascii")
    return f"data:image/png;base64,{b64}"


def encode_labels_base64(labels: np.ndarray) -> str:
    """Encode a uint8/int32 label array to base64 string."""
    return base64.b64encode(labels.astype(np.uint8).tobytes()).decode("ascii")


def resize_image(image: np.ndarray, width: int, height: int) -> np.ndarray:
    """Resize image to target dimensions."""
    return cv2.resize(image, (width, height), interpolation=cv2.INTER_LANCZOS4)
