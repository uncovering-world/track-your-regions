from skimage.segmentation import slic
import numpy as np


def compute_slic(
    image: np.ndarray,
    n_segments: int = 300,
    compactness: float = 10.0,
) -> np.ndarray:
    """Compute SLIC superpixels using scikit-image.
    Returns label array (int32, one label per pixel).
    Input image should be BGR (OpenCV format)."""
    rgb = image[:, :, ::-1]  # BGR → RGB for skimage
    labels = slic(rgb, n_segments=n_segments, compactness=compactness, start_label=0)
    return labels.astype(np.int32)
