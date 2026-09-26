from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1] / 'public' / 'icons'
ROOT.mkdir(parents=True, exist_ok=True)
GOLD, BLACK = '#f3c969', '#09090b'

def build(size: int, maskable: bool = False):
    image = Image.new('RGB', (size, size), BLACK)
    draw = ImageDraw.Draw(image)
    margin = int(size * (0.10 if maskable else 0.035))
    draw.rounded_rectangle((margin, margin, size-margin-1, size-margin-1), radius=int(size*.20), outline=GOLD, width=max(3, int(size*.024)))
    outer = [(256,68),(200,150),(125,215),(85,275),(92,335),(135,380),(190,385),(230,360),(215,405),(175,445),(337,445),(297,405),(282,360),(322,385),(377,380),(420,335),(427,275),(387,215),(312,150)]
    scale, cx, cy = size/512, size/2, size*.51
    convert = lambda points: [((x-256)*scale+cx, (y-264)*scale+cy) for x,y in points]
    draw.polygon(convert(outer), fill=GOLD)
    facet = max(2, int(size*.025))
    draw.line(convert([(256,68),(256,360)]), fill='#735d31', width=facet)
    draw.line(convert([(125,215),(256,335),(387,215)]), fill='#735d31', width=facet, joint='curve')
    return image

build(192).save(ROOT/'theibs-192.png', optimize=True)
build(512).save(ROOT/'theibs-512.png', optimize=True)
build(512, True).save(ROOT/'theibs-maskable-512.png', optimize=True)
