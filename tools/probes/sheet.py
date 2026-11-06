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
# the reference from above: the Sentinel-2 composite of the capture's month (the seasons step) when given and present, so a
# wet-season render is judged against the wet season; else the tile's imagery (NAIP, or the all-year Sentinel-2 median)
month = int(sys.argv[7]) if len(sys.argv) > 7 else None
mp = f'tiles/{tile}/seasons/s2_{month:02d}.tif' if month else None
import os
if mp and os.path.exists(mp):
    with rasterio.open(mp) as s:
        r=s.res[0]; c0=int((cx-half_h)/r); c1=int((cx+half_h)/r); r0=int((10000-cy-half_v)/r); r1=int((10000-cy+half_v)/r)
        a=s.read([1,2,3], window=((r0,r1),(c0,c1))).astype('float32')
    x=np.clip(np.nan_to_num(a)/0.35,0,1); x=np.where(x<=0.0031308,12.92*x,1.055*np.power(x,1/2.4)-0.055)
    a=(x*255).astype('uint8'); ref=f'Sentinel-2, month {month}'
else:
    with rasterio.open(f'tiles/{tile}/imagery/naip.tif') as s:
        r=s.res[0]; c0=int((cx-half_h)/r); c1=int((cx+half_h)/r); r0=int((10000-cy-half_v)/r); r1=int((10000-cy+half_v)/r)
        a=s.read(window=((r0,r1),(c0,c1)))
    ref='imagery'
sat=Image.fromarray(np.moveaxis(a,0,-1)).resize((W,H))
# The fair reference (2026-11-06): the composite's reflectance as this viewer would show a flat Lambertian surface of it
# under the capture's own sun and sky, exposure and three's ACES curve (the light the capture recorded, <name>_light.json).
# reflectance/0.35 shown as sRGB (the panel above) is brighter than the viewer can make a surface of that reflectance:
# a reflectance of 0.035 judges L* 38 that way and renders about L* 19 under perfect light.
fair = None
lp = D+f'{name}_light.json'
if mp and os.path.exists(mp) and os.path.exists(lp):
    l = json.load(open(lp))
    with rasterio.open(mp) as s:
        refl = np.moveaxis(np.nan_to_num(s.read([1,2,3], window=((r0,r1),(c0,c1))).astype('float32')), 0, -1)
    Min=np.array([[0.59719,0.35458,0.04823],[0.07600,0.90834,0.01566],[0.02840,0.13383,0.83777]])
    Mout=np.array([[1.60475,-0.53108,-0.07367],[-0.10208,1.10813,-0.00605],[-0.00327,-0.07276,1.07602]])
    rrt=lambda v:(v*(v+0.0245786)-0.000090537)/(v*(0.983729*v+0.4329510)+0.238081)
    xf=refl/np.pi*(np.array(l['sun'])*max(l['dy'],0)+np.array(l['amb']))*l['exp']/0.6
    yf=np.clip(np.einsum('ij,...j->...i',Mout,rrt(np.einsum('ij,...j->...i',Min,xf))),0,1)
    yf=np.where(yf<=0.0031308,12.92*yf,1.055*np.power(yf,1/2.4)-0.055)
    fair=Image.fromarray((yf*255).astype('uint8')).resize((W,H))
Lr, Ls = lab(ims[3]), lab(sat)
Lf = lab(fair) if fair is not None else None
st={'reference': ref, 'overlap': round(float(np.minimum(hist(Lr),hist(Ls)).sum()),3), 'L_render': round(float(np.median(Lr[:,0])),1), 'L_sat': round(float(np.median(Ls[:,0])),1), 'chroma_render': round(float(np.median(np.hypot(Lr[:,1],Lr[:,2]))),1), 'chroma_sat': round(float(np.median(np.hypot(Ls[:,1],Ls[:,2]))),1)}
if Lf is not None:
    st.update({'overlap_fair': round(float(np.minimum(hist(Lr),hist(Lf)).sum()),3), 'L_fair': round(float(np.median(Lf[:,0])),1),
               'chroma_fair': round(float(np.median(np.hypot(Lf[:,1],Lf[:,2]))),1)})
panels = ims+[sat]+([fair] if fair is not None else []); labels = [k[2:].replace('_',' ') for k in keys[:3]]+['top-down render, 900 m up',ref+', same footprint']+(['the same through the viewer\'s light'] if fair is not None else [])
sheet=Image.new('RGB',(W*2+10,H*3+20),'white'); d=ImageDraw.Draw(sheet)
for i,(im,l) in enumerate(zip(panels,labels)):
    x=(i%2)*(W+10); y=(i//2)*(H+10); sheet.paste(im,(x,y)); d.rectangle([x,y,x+240,y+18],fill='black'); d.text((x+4,y+3),l,fill='yellow')
sheet.save(D+f'sheet_{name}.jpg',quality=80)
for k,im in zip(keys,ims): im.resize((560,int(560*H/W))).save(O+f'{name}_{k}.jpg',quality=72)
sat.resize((560,int(560*H/W))).save(O+f'{name}_s2.jpg',quality=72)
p=D+'satellite_stats.json'; allst=json.load(open(p)); allst[name]=st; json.dump(allst,open(p,'w'),indent=1); print(name, st)
