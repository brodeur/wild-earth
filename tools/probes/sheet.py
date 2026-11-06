import sys, math, json, rasterio, numpy as np
from PIL import Image, ImageDraw
from skimage import color
N, name, tile, keys, cx, cy = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4].split(','), float(sys.argv[5]), float(sys.argv[6])
D=N+'/probe-captures/'; O=N+'/world-artifact/img/probes/'
def lab(im): return color.rgb2lab(np.asarray(im.convert('RGB').resize((320,int(320*im.height/im.width))),dtype=np.float32)/255).reshape(-1,3)
def hist(L): H,_,_=np.histogram2d(L[:,1],L[:,2],bins=16,range=[[-40,40],[-20,60]]); return H/H.sum()
ims=[Image.open(D+f'{name}_{k}.jpg').convert('RGB') for k in keys]
W=640; H=int(W*ims[0].height/ims[0].width); ims=[i.resize((W,H)) for i in ims]
half_v=900*math.tan(math.radians(25)); half_h=half_v*W/H
with rasterio.open(f'tiles/{tile}/imagery/naip.tif') as s:
    r=s.res[0]; c0=int((cx-half_h)/r); c1=int((cx+half_h)/r); r0=int((10000-cy-half_v)/r); r1=int((10000-cy+half_v)/r)
    a=s.read(window=((r0,r1),(c0,c1)))
sat=Image.fromarray(np.moveaxis(a,0,-1)).resize((W,H))
Lr, Ls = lab(ims[3]), lab(sat)
st={'overlap': round(float(np.minimum(hist(Lr),hist(Ls)).sum()),3), 'L_render': round(float(np.median(Lr[:,0])),1), 'L_sat': round(float(np.median(Ls[:,0])),1), 'chroma_render': round(float(np.median(np.hypot(Lr[:,1],Lr[:,2]))),1), 'chroma_sat': round(float(np.median(np.hypot(Ls[:,1],Ls[:,2]))),1)}
sheet=Image.new('RGB',(W*2+10,H*3+20),'white'); d=ImageDraw.Draw(sheet)
for i,(im,l) in enumerate(zip(ims+[sat],[k[2:].replace('_',' ') for k in keys[:3]]+['top-down render, 900 m up','satellite image, same footprint'])):
    x=(i%2)*(W+10); y=(i//2)*(H+10); sheet.paste(im,(x,y)); d.rectangle([x,y,x+240,y+18],fill='black'); d.text((x+4,y+3),l,fill='yellow')
sheet.save(D+f'sheet_{name}.jpg',quality=80)
for k,im in zip(keys,ims): im.resize((560,int(560*H/W))).save(O+f'{name}_{k}.jpg',quality=72)
sat.resize((560,int(560*H/W))).save(O+f'{name}_s2.jpg',quality=72)
p=D+'satellite_stats.json'; allst=json.load(open(p)); allst[name]=st; json.dump(allst,open(p,'w'),indent=1); print(name, st)
