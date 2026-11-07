"""A strip of screenshots with captions for tools/mp/visibility.mjs: strip.py '{"title", "out", "shots": [{file, caption}]}'.
Each shot is scaled to 480 px wide, in rows of up to four, a caption under each and the title over all."""
import json
import sys

from PIL import Image, ImageDraw, ImageFont

W, PAD, CAP, HEAD, PER_ROW = 480, 8, 22, 30, 4


def font(size):
    for path in ("/System/Library/Fonts/Supplemental/Arial.ttf", "/System/Library/Fonts/Helvetica.ttc"):
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            pass
    return ImageFont.load_default()


def main(spec):
    shots = [s for s in spec["shots"] if s and s.get("file")]
    ims = []
    for s in shots:
        im = Image.open(s["file"]).convert("RGB")
        ims.append(im.resize((W, round(im.height * W / im.width))))
    if not ims:
        return
    h = max(i.height for i in ims)
    cols = min(PER_ROW, len(ims))
    rows = (len(ims) + cols - 1) // cols
    sheet = Image.new("RGB", (PAD + cols * (W + PAD), HEAD + rows * (h + CAP + PAD) + PAD), (18, 20, 24))
    d = ImageDraw.Draw(sheet)
    d.text((PAD, 7), spec["title"], fill=(235, 238, 242), font=font(16))
    for k, (im, s) in enumerate(zip(ims, shots)):
        x, y = PAD + (k % cols) * (W + PAD), HEAD + (k // cols) * (h + CAP + PAD)
        sheet.paste(im, (x, y))
        d.text((x + 2, y + h + 3), s.get("caption", ""), fill=(200, 205, 212), font=font(13))
    sheet.save(spec["out"], quality=82)


if __name__ == "__main__":
    main(json.loads(sys.argv[1]))
