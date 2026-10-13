import json, sys
from PIL import Image, ImageDraw
man = json.load(open("out/manifest.json"))
names = sys.argv[2:] or list(man)
S = int(sys.argv[1]) if len(sys.argv) > 1 else 3
ims = [(n, Image.open(f"out/{n}.png")) for n in names]
cols = 6
cw = max(i.width for _, i in ims) * S + 16
rows = (len(ims) + cols - 1) // cols
rh = []
for r in range(rows):
    rh.append(max(i.height for _, i in ims[r*cols:(r+1)*cols]) * S + 26)
sheet = Image.new("RGBA", (cw * min(cols, len(ims)), sum(rh)), (196, 204, 214, 255))
d = ImageDraw.Draw(sheet)
y = 0
for r in range(rows):
    for c, (n, im) in enumerate(ims[r*cols:(r+1)*cols]):
        big = im.resize((im.width * S, im.height * S), Image.NEAREST)
        x = c * cw + (cw - big.width) // 2
        sheet.alpha_composite(big, (x, y + rh[r] - 18 - big.height))
        d.text((c * cw + 6, y + rh[r] - 14), n, fill=(30, 36, 48, 255))
    y += rh[r]
sheet.save("sheet.png")
print(sheet.size)
