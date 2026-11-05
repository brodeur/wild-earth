# Build client/assets/salamander.glb, the ambient western red-backed salamander (Plethodon vehiculum), from a Meshy
# text-to-3D preview. tools/build_ensatina.py builds the Oregon ensatina from the same mesh with this module's build().
#
# Source: generated with Meshy (meshy.ai), text-to-3D preview, ai_model "meshy-6-lite", triangle remesh to 20,000 faces,
# task 01a1ad3a-5ecd-7016-9b71-8d57ee3f76e9, run by agent (Claude) for Aaron Brodeur on 2026-11-05 UTC. Prompt: "A western
# red-backed salamander (Plethodon vehiculum), a small slender woodland salamander, NOT a lizard, NOT a newt, no scales,
# smooth moist skin. One adult walking on the ground, side-on pose, body straight, four short thin legs splayed out to
# the sides with small toes. Realistic proportions: 10 cm long, the round tapering tail as long as the body, a slender
# cylindrical body with fine grooves along the sides, a small rounded head a little wider than the neck, small dark
# bulging eyes. A broad straight-edged reddish-orange stripe down the back from the head to the tail tip, dark
# grey-black sides with fine white flecks, a grey belly. No base, no ground. Game-ready, clean closed mesh." Record
# (prompt, cost, checksums): library/animals/jobs/plethodon_vehiculum/01a1ad3a-5ecd-7016-9b71-8d57ee3f76e9/job.json.
# Paid-plan API output, owned by the account holder (Meshy Terms of Use 3.2) and released with the project's assets
# under CC BY-SA 4.0; credit "generated with Meshy (meshy.ai)". The mesh carried no Meshy metadata to keep (Terms 2.4:
# asset.generator only).
#
# Rebuild (Blender 4.1, from the repo root):
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/build_salamander.py -- \
#       library/animals/jobs/plethodon_vehiculum/01a1ad3a-5ecd-7016-9b71-8d57ee3f76e9/model.glb client/assets/salamander.glb
#
# What it does (the reptile template of tools/build_fence_lizard.py, for an amphibian): recentres the body on the
# midline (the preview stands 0.1 units to one side); finds the four limbs from the geometry (outside the trunk's
# half-width or under the belly, connected to a foot) and their shoulder and hip rings; puts the vent just behind the
# hips; the preview's tail curls round to one side, so every tail vertex is carried to its arc station on a straight
# axis on the midline (the tail laid down to rest on the ground behind, at the same angle around the axis), scaled to
# the brief's tail length; scales snout to vent to the brief (0.05 m), the body across to its width (8 mm) and the
# height so the back stands ~7 mm. The dorsal stripe's edges are cut into the mesh as straight lines (two vertical
# planes x = +-2.6 mm along the trunk and head behind the eyes, two converging planes along the tail to its tip) and
# kept through the collapse, so the stripe is straight-edged on lod0 and lod1. Colour by region (sRGB palette, faint
# per-face noise): the broad reddish-orange stripe from the back of the head to the tail tip, dark grey-black sides
# with fine pale flecks (hashed faces), a grey belly mottled pale, dark eyes (the face nearest each eye point on lod0
# and lod1), dark grey limbs with the stripe colour on the upper arm and thigh. Decimates (collapse, X symmetry; each
# tier first collapsed to 1.6x / 1.2x its target, the stripe edges cut and kept, on lod1 the limbs kept back too) to
# lod0 ~800, lod1 ~300, lod2 ~80 triangles (lod2 a plain collapse, its stripe whole faces).
# Rig, the reptile template (as the fence lizard's; the client draws it with the lizard's spine wave and sprawling
# walk): BODY 0, LEG_A 1 (left fore, right hind) and LEG_B 2 (right fore, left hind), splayed, pivots at the shoulder
# and hip rings; HEAD 6 (pivot at the neck); TAIL 3 (inner half, pivot at the vent) and TAIL_TIP 8 (outer half, pivot
# mid-tail, child of the tail). The per-vertex _BLUE attribute is kept (0 everywhere: a salamander has no blue
# patches) so the shader path is the lizard's. extras.rig (kind 'reptile'): head, tail, tail_tip, fore, hind, legs,
# snout_z, vent_z, tail_end_z, belly_y, back_y, drop, blue_off, throat_off, length_m.
import bpy, bmesh, sys, os, math
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import animal_glb as A

HEAD_, TAIL, TAIL_TIP = 6, 3, 8

SALAMANDER = dict(
    species='plethodon_vehiculum', name='Western red-backed salamander', script='tools/build_salamander.py',
    job='01a1ad3a-5ecd-7016-9b71-8d57ee3f76e9',
    tiers=[('lod0', 800), ('lod1', 300), ('lod2', 80)],
    svl=0.05, tail=0.05, width=0.008, back=0.007,
    stripe_half=0.0026,          # m: the stripe 5.2 mm wide on the 8 mm trunk (seen from above it covers most of the back)
    legs=1.0, constrict=None, eye_scale=1.0,
    note='recentred, tail straightened, reshaped, recoloured, decimated',
)


def build(cfg, SRC, OUT):
    SVL, TAIL_M = cfg['svl'], cfg['tail']
    ob = A.import_glb_mesh(SRC)
    me = ob.data; V = me.vertices
    z0 = min(v.co.z for v in V)
    for v in V: v.co.z -= z0
    # ---- recentre on the midline: the median centre of the narrow slices (the trunk and head, not legs or the curl) ----
    ys = [v.co.y for v in V]; ylo, yhi = min(ys), max(ys)
    BIN = 0.025
    rows = {}
    for v in V: rows.setdefault(int((v.co.y - ylo) // BIN), []).append(v.co)
    cen = sorted((min(p.x for p in c) + max(p.x for p in c)) / 2 for c in rows.values() if max(p.x for p in c) - min(p.x for p in c) < 0.32)
    X0 = cen[len(cen) // 2]
    for v in V: v.co.x -= X0
    me.update()
    adj = A.adjacency(me)
    nose = min(V, key=lambda v: v.co.y).co.copy()
    print('INFO recentred x by', round(-X0, 4), 'from', len(cen), 'slices; nose', [round(x, 3) for x in nose])

    # ---- trunk profile per y: half-width from the upper half (above the limbs), belly and back z on the midline ----
    rows = {}
    for v in V: rows.setdefault(int(math.floor((v.co.y - nose.y) / BIN)), []).append(v.co)
    prof = {}
    for k, c in rows.items():
        mid = [p.z for p in c if abs(p.x) < 0.03]
        if not mid: continue
        zt, zb = max(mid), min(mid)
        up = [abs(p.x) for p in c if p.z > (zt + zb) / 2 and abs(p.x) < 0.3]
        prof[k] = (max(up, default=0.01), zb, zt)
    def P(y):
        k = int(math.floor((y - nose.y) / BIN))
        while k not in prof and k > 0: k -= 1
        return prof.get(k, (0.01, 0.0, 0.0))

    # ---- limbs: outside the trunk or under the belly, connected to a foot, ahead of the tail ----
    Y_LIMB = 0.40                                    # (source units) the hind feet end before here; the tail's curl lies behind
    feet = set(v.index for v in V if v.co.z < 0.015 and v.co.y < Y_LIMB)
    cand = [v.index for v in V if nose.y + 0.15 < v.co.y < Y_LIMB and
            (abs(v.co.x) > P(v.co.y)[0] * 1.08 + 0.012 or v.co.z < P(v.co.y)[1] - 0.012)]
    comps = A.components(adj, cand)
    limbs = [c for c in comps if feet & set(c)][:4]
    assert len(limbs) == 4, [len(c) for c in comps[:6]]
    tmp = []
    for c in limbs:
        cs = set(c)
        cc = sum((V[i].co for i in c), Vector()) / len(c)
        ring = [V[i].co for i in c if any(u not in cs for u in adj[i])]
        tmp.append((sum(ring, Vector()) / len(ring), cc, cs))
    tmp.sort(key=lambda r: r[0].y)
    pivots = {}; limbset = {}
    for j, (piv, cc, cs) in enumerate(tmp):
        k = (j < 2, cc.x > 0)
        pivots[k] = piv; limbset[k] = cs
    assert len(pivots) == 4, pivots.keys()
    limb_of = {i: k for k, s in limbset.items() for i in s}
    hind_ring_y = max(V[i].co.y for k in ((False, True), (False, False)) for i in limbset[k] if any(u not in limbset[k] for u in adj[i]))
    VENT_Y = hind_ring_y + 0.03
    print('INFO limbs', {('F' if k[0] else 'H') + ('L' if k[1] else 'R'): (len(s), [round(x, 3) for x in pivots[k]]) for k, s in limbset.items()},
          'vent y', round(VENT_Y, 3))

    # ---- tail: behind the vent, the piece holding the farthest point; straightened onto the midline ----
    tail = [v.index for v in V if v.co.y > VENT_Y and v.index not in limb_of]
    far = max(V, key=lambda v: v.co.y).index
    tail = next(c for c in A.components(adj, tail) if far in c)
    tailset = set(tail)
    roots = [i for i in tail if any(V[u].co.y <= VENT_Y for u in adj[i])]
    TA, tfrac = A.tube_axis(me, adj, tail, roots, bins=24)
    L0 = sum((TA[i + 1] - TA[i]).length for i in range(len(TA) - 1))
    S = SVL / (VENT_Y - nose.y)
    K = TAIL_M / (L0 * S)
    rad = [[] for _ in TA]
    for i in tail:
        b = min(len(TA) - 1, int(tfrac[i] * len(TA)))
        rad[b].append((V[i].co - TA[b]).length)
    R = [sum(r) / len(r) if r else 0.0 for r in rad]
    cum = [0.0]
    for i in range(len(TA) - 1): cum.append(cum[-1] + (TA[i + 1] - TA[i]).length * K)
    NA = []
    for i in range(len(TA)):
        t = cum[i] / cum[-1]
        zt = R[i] + 0.004 + (TA[0].z - R[0] - 0.004) * (1 - A.smooth(0.0, 0.5, t))
        NA.append(Vector((0.0, 0.0, zt)))
    NA[0].y = TA[0].y
    for i in range(1, len(NA)):
        dz = NA[i].z - NA[i - 1].z; L = cum[i] - cum[i - 1]
        NA[i].y = NA[i - 1].y + math.sqrt(max(1e-12, L * L - dz * dz))
    con = cfg.get('constrict')
    for i in tail:
        t = tfrac.get(i, 0.0)
        radial = con(t) if con else 1.0
        V[i].co = A.remap_along(TA, NA, V[i].co, 1.0, radial)
    TA = NA
    me.update()
    print('INFO tail source length', round(L0 * S, 4), 'm (curled), stretch', round(K, 3), 'root radius', round(R[0] * S, 4))

    # ---- landmarks (source units, before the squash) ----
    y_sh = sum(pivots[k].y for k in pivots if k[0]) / 2
    y_hip = sum(pivots[k].y for k in pivots if not k[0]) / 2
    neck_y = nose.y + 0.2 * (VENT_Y - nose.y)        # the head ~20% of snout-vent (the preview's neck shows no narrowing)
    _, zb, zt = P(neck_y)
    NB = Vector((0, neck_y, (zb + zt) / 2))
    headv = [v.co for v in V if v.co.y < nose.y + 0.08]
    headc = sum(headv, Vector()) / len(headv)
    NDIR = (headc - NB).normalized()
    ymid_t = (y_sh + y_hip) / 2
    back_src = max(v.co.z for v in V if abs(v.co.x) < 0.03 and abs(v.co.y - ymid_t) < 0.03)
    w_src = P(ymid_t)[0]
    HEIGHT = cfg['back'] / (back_src * S)
    XS = cfg['width'] / 2 / (w_src * S)
    print('INFO neck y', round(neck_y, 3), 'shoulders y', round(y_sh, 3), 'hips y', round(y_hip, 3), 'height squash', round(HEIGHT, 3), 'width scale', round(XS, 3))

    # ---- the eyes (source units): the bulge on each side of the head, a third of the way back from the snout ----
    hl = neck_y - nose.y
    eyev = [v.co for v in V if 0.2 * hl < v.co.y - nose.y < 0.55 * hl and v.co.x > 0 and v.co.z > P(v.co.y)[1] + 0.55 * (P(v.co.y)[2] - P(v.co.y)[1])]
    EYE_SRC = max(eyev, key=lambda p: p.x + 0.6 * p.z).copy()
    print('INFO eye (source)', [round(x, 3) for x in EYE_SRC])

    # ---- variant reshaping in source units: legs longer about their pivots, eyes bigger about their centres ----
    if cfg['legs'] != 1.0:
        for i, k in limb_of.items():
            pv = pivots[k]; V[i].co = pv + (V[i].co - pv) * cfg['legs']
    if cfg['eye_scale'] != 1.0:
        er = 0.045
        for sx in (1, -1):
            ec = Vector((sx * EYE_SRC.x, EYE_SRC.y, EYE_SRC.z)) - Vector((sx * er * 0.6, 0, er * 0.3))
            for v in V:
                d = (v.co - ec).length
                if d < er * 1.6 and v.index not in limb_of:
                    w = A.smooth(er * 1.6, er * 0.9, d)
                    v.co = ec + (v.co - ec) * (1 + (cfg['eye_scale'] - 1) * w)
        EYE_SRC = EYE_SRC + Vector((er * 0.6, 0, er * 0.3)) * (cfg['eye_scale'] - 1)

    # ---- scale and squash: metres, origin on the ground between the shoulders and hips ----
    yorg = (y_sh + y_hip) / 2
    def sc(p): return Vector((p.x * S * XS, (p.y - yorg) * S, p.z * HEIGHT * S))
    for v in V: v.co = sc(v.co)
    zmin = min(v.co.z for v in V)
    for v in V: v.co.z -= zmin      # longer legs lift the body
    me.update()
    lift = -zmin
    def sc2(p): q = sc(p); q.z -= zmin; return q
    TA = [sc2(p) for p in TA]; NB = sc2(NB)
    NDIR = Vector((NDIR.x * XS, NDIR.y, NDIR.z * HEIGHT)).normalized()
    pivots = {k: sc2(p) for k, p in pivots.items()}
    nose = sc2(nose); EYE_P = sc2(EYE_SRC)
    VY = (VENT_Y - yorg) * S; Y_SH = (y_sh - yorg) * S; Y_HIP = (y_hip - yorg) * S
    def W(y): return P(y / S + yorg)[0] * S * XS
    tail_len = sum((TA[i + 1] - TA[i]).length for i in range(len(TA) - 1))
    acc = 0.0; TIP = TA[-1]
    for i in range(len(TA) - 1):
        L = (TA[i + 1] - TA[i]).length
        if acc + L >= tail_len / 2: TIP = TA[i] + (TA[i + 1] - TA[i]) * ((tail_len / 2 - acc) / L); break
        acc += L

    # ---- membership into vertex groups (the stripe cuts add vertices; groups interpolate onto them) ----
    gl = {k: ob.vertex_groups.new(name='L' + ('F' if k[0] else 'H') + ('L' if k[1] else 'R')) for k in pivots}
    gt = ob.vertex_groups.new(name='tail'); gf = ob.vertex_groups.new(name='tfrac')
    for i, k in limb_of.items(): gl[k].add([i], 1.0, 'REPLACE')
    for i in tailset:
        gt.add([i], 1.0, 'REPLACE'); gf.add([i], max(1e-4, tfrac.get(i, 0.0)), 'REPLACE')

    # ---- the stripe's edges cut in as straight lines (per tier, on a copy pre-decimated to 1.6x its target) ----
    SW = cfg['stripe_half']
    y_start = EYE_P.y + 0.0015         # the stripe starts on the head just behind the eyes
    TE = TA[-1]
    rw = SW * min(1.0, R[0] * S * XS / max(W(VY - 0.003), 1e-4))
    stripe_half_at = lambda y: SW if y < VY else rw * max(0.0, (TE.y - y) / (TE.y - VY))
    def cut_stripe(o, limb_w=0.0):
        me_ = o.data
        bm = bmesh.new(); bm.from_mesh(me_)
        dl = bm.verts.layers.deform.active
        gi = {g.name: g.index for g in o.vertex_groups}
        def gw(v, n): return v[dl].get(gi[n], 0.0) if dl else 0.0
        cut = set()
        for sx in ((1, -1) if cfg.get('cut', True) else ()):
            # the trunk and head: vertical planes x = +-SW, on the top half of the body between the head and the vent
            faces = [f for f in bm.faces if y_start - 0.003 < f.calc_center_median().y < VY + 0.002 and all(gw(v, 'tail') < 0.5 for v in f.verts)
                     and f.calc_center_median().z > 0.45 * back_mid0]
            geom = list({e for f in faces for e in f.edges}) + faces + list({v for f in faces for v in f.verts})
            r = bmesh.ops.bisect_plane(bm, geom=geom, plane_co=Vector((sx * SW, 0, 0)), plane_no=Vector((1, 0, 0)))
            cut |= {g for g in r['geom_cut'] if isinstance(g, bmesh.types.BMVert)}
            # the tail: planes through the vertical, from +-rw at the vent converging to the tip
            a_ = Vector((sx * rw, VY, 0)); b_ = Vector((0, TE.y + 0.0005, 0))
            d = (b_ - a_).normalized(); no = Vector((d.y, -d.x, 0))
            faces = [f for f in bm.faces if f.calc_center_median().y > VY - 0.002 and any(gw(v, 'tail') > 0.5 for v in f.verts)]
            geom = list({e for f in faces for e in f.edges}) + faces + list({v for f in faces for v in f.verts})
            r = bmesh.ops.bisect_plane(bm, geom=geom, plane_co=a_, plane_no=no)
            cut |= {g for g in r['geom_cut'] if isinstance(g, bmesh.types.BMVert)}
        bm.verts.index_update()
        idx = [v.index for v in cut]
        bm.to_mesh(me_); bm.free(); me_.update()
        A.triangulate(me_)
        o.vertex_groups['protect'].add(idx, 1.0, 'REPLACE')
        if limb_w:   # the limbs kept back too (on the small tier a collapse takes the thin legs first)
            lg = {o.vertex_groups[n].index for n in ('LFL', 'LFR', 'LHL', 'LHR')}
            o.vertex_groups['protect'].add([v.index for v in me_.vertices if any(g.group in lg and g.weight > 0.5 for g in v.groups)], limb_w, 'REPLACE')
        return len(idx)

    # ---- rig on the working mesh, carried through decimation in vertex groups ----
    gidx = {g.index: g.name for g in ob.vertex_groups}
    def groups_of(v): return {gidx[g.group]: g.weight for g in v.groups}
    def rig_full(v):
        p = v.co; w = groups_of(v)
        if w.get('tail', 0) > 0.5:
            t = w.get('tfrac', 0.0)
            if t >= 0.5: return dict(part=TAIL_TIP, partw=A.smooth(0.5, 0.62, t), pivot=TIP)
            return dict(part=TAIL, partw=A.smooth(0.0, 0.1, t), pivot=TA[0])
        for k in pivots:
            n = 'L' + ('F' if k[0] else 'H') + ('L' if k[1] else 'R')
            if w.get(n, 0) > 0.5:
                pv = pivots[k]
                return dict(part=1 if k[0] == k[1] else 2, partw=A.smooth(0.0004, 0.003, (p - pv).length), pivot=pv)
        wh = A.smooth(-0.001, 0.003, (p - NB).dot(NDIR))
        if wh > 0: return dict(part=HEAD_, partw=wh, pivot=NB)
        return dict(part=0, partw=0.0, pivot=Vector())
    RIGF = [rig_full(v) for v in V]
    pg = {n: ob.vertex_groups.new(name=n) for n in ('p1', 'p2', 'p3', 'p6', 'p8')}
    prot = ob.vertex_groups.new(name='protect')
    for i, r in enumerate(RIGF):
        if r['part']: pg[f"p{r['part']}"].add([i], max(1e-4, r['partw']), 'REPLACE')

    # ---- landmarks ----
    trunk = [v.co for v in V if Y_SH < v.co.y < Y_HIP and RIGF[v.index]['part'] == 0]
    back_mid = back_mid0 = max(v.co.z for v in V if abs(v.co.x) < 0.001 and abs(v.co.y - (Y_SH + Y_HIP) / 2) < 0.002)
    midc = [v.co for v in V if abs(v.co.y - (Y_SH + Y_HIP) / 2) < 0.0015 and RIGF[v.index]['part'] == 0]
    belly = min(p.z for p in midc if abs(p.x) < 0.001)
    width = 2 * max(abs(p.x) for p in midc)
    span = max(abs(v.co.x) for v in V) * 2
    print('LANDMARKS svl', round(VY - nose.y, 4), 'tail', round(tail_len, 4), 'total (straight)', round(max(v.co.y for v in V) - nose.y, 4),
          'back at mid', round(back_mid, 4), 'belly clearance', round(belly, 4), 'trunk width', round(width, 4), 'toe span', round(span, 4),
          'head top', round(max(v.co.z for v in V), 4), 'body lift', round(lift, 4), 'eye', [round(x, 4) for x in EYE_P],
          'neck', [round(x, 4) for x in NB], 'vent y', round(VY, 4), 'tail tip', [round(x, 4) for x in TE],
          'pivots', {('F' if k[0] else 'H') + ('L' if k[1] else 'R'): [round(x, 4) for x in p] for k, p in pivots.items()})

    pal = cfg['palette']
    def region(m, p, R, tw, eye_faces, far):
        """sRGB hex for a face; far: the coarse tier."""
        c = p.center; n = p.normal
        if p.index in eye_faces: return pal['eye']
        if cfg.get('eye_fleck') and p.index in fleck_faces: return pal['eye_fleck']
        h = A.hash01(abs(c.x) * 4000 // 1, c.y * 4000 // 1, c.z * 4000 // 1)
        parts = [R[i]['part'] for i in p.vertices]
        if sum(tw[i] for i in p.vertices) / len(p.vertices) > 0.5:
            d, t, q = A.poly_nearest(c, TA)
            up = (c - q).normalized().z if (c - q).length > 1e-7 else 0
            if abs(c.x) < stripe_half_at(c.y) and up > 0: return pal['stripe'] if far or h > pal.get('back_fleck', 0) or p.area > pal['fleck_area'] else pal['stripe_fleck']
            if up < -0.6: return pal['belly'] if far or h > pal['mottle'] or p.area > pal['fleck_area'] else pal['belly_pale']
            return pal['side'] if far or h > pal['fleck'] or p.area > pal['fleck_area'] else pal['side_fleck']
        small = p.area < pal['fleck_area']          # flecks only on small faces (a big pale face reads as a patch)
        if sum(1 for x in parts if x in (1, 2)) * 2 > len(parts):
            pv = pivots[(c.y < (Y_SH + Y_HIP) / 2, c.x > 0)]
            if (c - pv).length < pal['limb_top_r'] and n.z > pal['limb_top_nz']: return pal['limb_top']
            if n.z < -0.3: return pal['limb_under']
            return pal['limb']
        head = sum(1 for x in parts if x == HEAD_) * 2 > len(parts)
        top = c.z > (NB.z if head else ZM(c.y))
        if c.y > y_start and abs(c.x) < SW and top and n.z > -0.2: return pal['stripe'] if far or h > pal.get('back_fleck', 0) or not small else pal['stripe_fleck']
        if head and c.y <= y_start and n.z > 0.3: return pal['head_top']
        # the upper arm and thigh (the body skin out to the limb's ring) touched with the stripe colour on top
        pv = pivots[(c.y < (Y_SH + Y_HIP) / 2, c.x > 0)]
        if abs(c.x) > W(c.y) * 1.15 and abs(c.y - pv.y) < pal['limb_base_dy'] and n.z > pal['limb_top_nz']: return pal['limb_top']
        if n.z < -0.35: return pal['belly'] if far or h > pal['mottle'] or not small else pal['belly_pale']
        return pal['side'] if far or h > pal['fleck'] or not small else pal['side_fleck']
    def ZM(y):   # the body's mid height at y (the stripe sits above it)
        return 0.5 * back_mid

    def emit_blue(m, colour, vert_rig):
        key2i = {}; out = dict(pos=[], col=[], part=[], partw=[], piv=[], idx=[], blue=[]); rig = {}
        for p in m.polygons:
            fc = colour(p)
            for vi in p.vertices:
                k = (vi, fc)
                if k not in key2i:
                    key2i[k] = len(out['pos'])
                    if vi not in rig: rig[vi] = vert_rig(vi)
                    r = rig[vi]
                    out['pos'].append(A.to3(m.vertices[vi].co)); out['col'].append(fc); out['blue'].append(0.0)
                    out['part'].append(float(r['part'])); out['partw'].append(float(r['partw'])); out['piv'].append(A.to3(r['pivot']))
                out['idx'].append(key2i[k])
        return out

    tiers = []
    fleck_faces = set()
    for name, target in cfg['tiers']:
        if name == 'lod2': o, _ = A.tier_copy(ob, target)
        else:
            o1, _ = A.tier_copy(ob, int(target * (1.6 if name == 'lod0' else 1.2)))
            nc = cut_stripe(o1, 0.0 if name == 'lod0' else 0.8)
            o, _ = A.tier_copy(o1, target, protect='protect')
            bpy.data.objects.remove(o1)
            print('INFO', name, 'stripe edge vertices', nc)
        m = o.data
        gi2 = {g.index: g.name for g in o.vertex_groups}
        R = {}; TW = {}
        for v in m.vertices:
            w = {gi2[g.group]: g.weight for g in v.groups}
            TW[v.index] = w.get('tail', 0.0)
            pid = max((k for k in ('p1', 'p2', 'p3', 'p6', 'p8') if k in w), key=lambda k: w[k], default=None)
            if pid is None: R[v.index] = dict(part=0, partw=0.0, pivot=Vector()); continue
            part = int(pid[1:]); co = v.co
            if part in (1, 2):
                fore = co.y < (Y_SH + Y_HIP) / 2; left = co.x > 0
                piv = pivots[(fore, left)]
            else:
                piv = {HEAD_: NB, TAIL: TA[0], TAIL_TIP: TIP}[part]
            R[v.index] = dict(part=part, partw=min(1.0, w[pid]), pivot=piv)
        eye_faces = set(); fleck_faces = set()
        if name != 'lod2':
            for sx in (1, -1):
                q = Vector((sx * EYE_P.x, EYE_P.y, EYE_P.z))
                f = min(m.polygons, key=lambda f: (f.center - q).length + (0 if f.normal.x * sx > 0.2 else 1))
                eye_faces.add(f.index)
                if cfg.get('eye_scale', 1.0) > 1.0:   # the big eye: the faces round it within its radius too
                    eye_faces |= {g.index for g in m.polygons if (g.center - q).length < cfg['eye_r'] and g.normal.x * sx > 0.2}
                if cfg.get('eye_fleck'):
                    up = Vector((sx * EYE_P.x * 0.8, EYE_P.y, EYE_P.z + cfg['eye_r'] * 1.2))
                    g = min((g for g in m.polygons if g.index not in eye_faces and g.normal.z > 0.2), key=lambda g: (g.center - up).length)
                    fleck_faces.add(g.index)
        far = name == 'lod2'
        def colour(p):
            hexc = region(m, p, R, TW, eye_faces, far)
            if p.index in eye_faces: return tuple(A.srgb2lin(hexc))
            return tuple(A.grizzle(hexc, p.center, 0.06, 0.0015))
        t = emit_blue(m, colour, lambda i: R[i])
        print('TIER', name, len(t['idx']) // 3, 'triangles', 'eye faces', len(eye_faces))
        bpy.data.objects.remove(o)
        tiers.append((name, t))

    r4 = lambda p: [round(x, 4) for x in A.to3(p)]
    A.write_glb(OUT, tiers, f"wild-earth {cfg['script']} (Blender)",
                f"{cfg['name']} generated with Meshy (meshy.ai), text-to-3D preview task {cfg['job']}, for Wild Earth; CC BY-SA 4.0; {cfg['note']}",
                extra_names=('blue',),
                extras={'rig': {'kind': 'reptile', 'head': r4(NB), 'tail': r4(TA[0]), 'tail_tip': r4(TIP),
                                'fore': r4(pivots[(True, True)]), 'hind': r4(pivots[(False, True)]),
                                'legs': {'FL': r4(pivots[(True, True)]), 'FR': r4(pivots[(True, False)]), 'HL': r4(pivots[(False, True)]), 'HR': r4(pivots[(False, False)])},
                                'snout_z': round(-nose.y, 4), 'vent_z': round(-VY, 4), 'tail_end_z': round(-TA[-1].y, 4),
                                'belly_y': round(belly, 4), 'back_y': round(back_mid, 4), 'drop': round(belly * 0.85, 4),
                                'blue_off': [round(x, 4) for x in A.srgb2lin(pal['belly'])], 'throat_off': [round(x, 4) for x in A.srgb2lin(pal['belly'])],
                                'length_m': round(SVL + TAIL_M, 4)},
                        'species': cfg['species'], 'svl_m': SVL, 'tail_m': TAIL_M, 'height_scale': round(HEIGHT, 3), 'width_scale': round(XS, 3),
                        'tail_stretch': round(K, 3), 'meshy_task': cfg['job'], **({'variant_of': cfg['variant_of']} if cfg.get('variant_of') else {}),
                        'parts': 'reptile template: BODY 0, LEG_A 1 (left fore, right hind), LEG_B 2 (right fore, left hind), pivots at the shoulder and hip; HEAD 6 (pivot at the neck); TAIL 3 (inner half, pivot at the vent), TAIL_TIP 8 (outer half, pivot mid-tail, child of TAIL); _BLUE 0 everywhere (no blue patches; kept for the shader path)'})


SALAMANDER['palette'] = dict(
    stripe=0xc4572a, side=0x2a2826, side_fleck=0xb8b3a8, fleck=0.16, fleck_area=2.5e-6, belly=0x5b5a58, belly_pale=0x8c8a85, mottle=0.3,
    eye=0x0b0a0a, head_top=0x3a2e28, limb=0x3a3836, limb_under=0x55534f, limb_top=A.mix(0xc4572a, 0x3a3836, 0.55), limb_top_r=0.0012, limb_top_nz=0.3, limb_base_dy=0.0025,
)

if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:]
    build(SALAMANDER, argv[0], argv[1])
