"""Local PP-OCRv6 Small worker. Exactly one JSON result on stdout."""
import argparse
import contextlib
import json
import os
from pathlib import Path
import shutil
import sys
import tarfile
import tempfile
import urllib.request

MODELS = ('PP-OCRv6_small_det', 'PP-OCRv6_small_rec')
BASE_URL = 'https://paddle-model-ecology.bj.bcebos.com/paddlex/official_inference_model/paddle3.0.0/'
MAX_PIXELS = 40_000_000
MAX_BYTES = 25 * 1024 * 1024


def prepare_models(home):
    models = home / 'models'
    models.mkdir(parents=True, exist_ok=True)
    for name in MODELS:
        destination = models / name
        if (destination / 'inference.yml').is_file():
            continue
        print(f'Downloading {name}…', file=sys.stderr, flush=True)
        with tempfile.TemporaryDirectory(dir=home) as work:
            archive = Path(work) / 'model.tar'
            with urllib.request.urlopen(BASE_URL + name + '_infer.tar', timeout=90) as response, archive.open('wb') as output:
                shutil.copyfileobj(response, output)
            extracted = Path(work) / 'extracted'
            with tarfile.open(archive) as bundle:
                bundle.extractall(extracted, filter='data')
            configs = list(extracted.rglob('inference.yml'))
            if len(configs) != 1:
                raise ValueError('The downloaded model package is invalid.')
            if destination.exists():
                shutil.rmtree(destination)
            shutil.move(str(configs[0].parent), destination)


def engine(home):
    from paddleocr import PaddleOCR
    for name in MODELS:
        if not (home / 'models' / name / 'inference.yml').is_file():
            raise ValueError('OCR models are missing. Set up image import again.')
    return PaddleOCR(
        text_detection_model_name=MODELS[0],
        text_recognition_model_name=MODELS[1],
        text_detection_model_dir=str(home / 'models' / MODELS[0]),
        text_recognition_model_dir=str(home / 'models' / MODELS[1]),
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
        device='cpu', cpu_threads=4, enable_mkldnn=False,
    )


def extract(path, home):
    from PIL import Image, ImageOps
    import numpy as np
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    if not path.is_file() or path.stat().st_size > MAX_BYTES:
        raise ValueError('Choose an image smaller than 25 MB.')
    with Image.open(path) as source:
        if source.format not in ('PNG', 'JPEG', 'WEBP', 'BMP', 'TIFF'):
            raise ValueError('Choose a PNG, JPEG, WebP, BMP, or TIFF image.')
        if source.width * source.height > MAX_PIXELS:
            raise ValueError('The image is too large. Use an image under 40 megapixels.')
        image = ImageOps.exif_transpose(source).convert('RGBA')
        white = Image.new('RGBA', image.size, 'white')
        white.alpha_composite(image)
        # Paddle's image-array input is BGR.
        pixels = np.asarray(white.convert('RGB'))[:, :, ::-1].copy()
    lines = []
    scores = []
    items = []
    for result in engine(home).predict(pixels):
        boxes = result.get('rec_boxes')
        for i, (text, score) in enumerate(zip(result['rec_texts'], result['rec_scores'])):
            if text.strip():
                lines.append(text.strip())
                scores.append(float(score))
                # Positions let the app rebuild reading order (columns, blocks).
                if boxes is not None and i < len(boxes):
                    items.append({'text': text.strip(), 'box': [int(v) for v in boxes[i][:4]]})
    text = '\n'.join(lines)
    if len(text) > 100000:
        raise ValueError('The extracted text exceeds the bit size limit. Crop the image and try again.')
    result = {'text': text, 'lines': len(lines), 'confidence': round(sum(scores) / len(scores), 3) if scores else None, 'engine': 'PP-OCRv6 Small'}
    if len(items) == len(lines):
        result['items'] = items
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--home', required=True, type=Path)
    parser.add_argument('--prepare', action='store_true')
    parser.add_argument('--image', type=Path)
    args = parser.parse_args()
    os.environ['PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK'] = 'True'
    os.environ['PADDLE_PDX_CACHE_HOME'] = str(args.home / 'cache')
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['OMP_NUM_THREADS'] = '1'
    try:
        with contextlib.redirect_stdout(sys.stderr):
            if args.prepare:
                prepare_models(args.home)
                engine(args.home)
                (args.home / 'ready.json').write_text(json.dumps({'engine': 'PP-OCRv6 Small', 'version': 1}))
                result = {'ready': True}
            elif args.image:
                result = extract(args.image, args.home)
            else:
                raise ValueError('No image selected.')
        print(json.dumps({'ok': True, **result}, ensure_ascii=False), flush=True)
    except Exception as exc:
        print(json.dumps({'ok': False, 'error': str(exc)}), flush=True)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
