from PIL import Image, ImageOps, ImageDraw
from pathlib import Path
images=sorted(Path('.').glob('sample-*.png'))
sheet=Image.new('RGB',(1200,1700),'#ddd')
for i,path in enumerate(images):
 im=Image.open(path).convert('RGB')
 # Pages use only their upper section; preserve all sample rows.
 im=im.crop((0,0,im.width,int(im.height*.78)))
 im.thumbnail((398,422))
 sheet.paste(im,((i%3)*400,(i//3)*425))
sheet.save('contact-sheet.png')
