# Build client/assets/western_toad.glb, the western toad (Anaxyrus boreas) of the Olympic Peninsula's forest floor, ponds
# and subalpine meadows, from a Meshy text-to-3D preview. tools/build_frog.py builds the Cascades frog from the same mesh
# with this module's build().
#
# Source: generated with Meshy (meshy.ai), text-to-3D preview, ai_model meshy-6-lite, triangle remesh to 20,000 faces
#   (untextured), task 01a1ae8d-0b79-7550-84cb-9b7d4e6f1127, run by agent (Claude) for Aaron Brodeur on 2026-11-06 01:50
#   UTC (the 2026-11-05 batch, US evening), 5 credits. Prompt: "A western toad (Anaxyrus boreas), NOT a frog, NOT a
#   cartoon. One adult sitting on the ground in a neutral crouch, side-on pose, the four legs folded under it, the front
#   feet planted. Realistic proportions: 10 cm long, a squat broad warty body, a blunt rounded head with big oval
#   parotoid glands behind the eyes, golden eyes with horizontal pupils, short thick legs. Olive-grey to greenish brown
#   skin with dark warts ringed in rusty brown, a thin pale cream stripe down the middle of the back, a pale mottled
#   belly. No base, no ground. Game-ready, clean closed mesh." Record (prompt, cost):
#   library/animals/jobs/anaxyrus_boreas/01a1ae8d-0b79-7550-84cb-9b7d4e6f1127/job.json.
# Licence: paid-plan API output, owned by the account holder (Meshy Terms of Use 3.2, https://www.meshy.ai/terms-of-use,
#   last updated 2026-09-19), released with the project's assets under CC BY-SA 4.0; credit "generated with Meshy
#   (meshy.ai)". Terms 2.4: the mesh carried no Meshy metadata to keep (asset.generator only).
#
# Rebuild (Blender 4.1, from the repo root):
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/build_toad.py -- \
#       library/animals/jobs/anaxyrus_boreas/01a1ae8d-0b79-7550-84cb-9b7d4e6f1127/model.glb client/assets/western_toad.glb
#
# What it does: keeps the generated crouching toad (warty, squat, the legs folded under it, the fore feet planted); finds
# its warts on the full mesh (each vertex's height over the mean of its neighbours along its normal, smoothed; the top
# fifth of the dorsal and limb skin) and carries that in a vertex group through the collapse; scales snout to vent to
# 0.10 m, the trunk to 6 cm across and the back to ~4 cm up; origin on the ground between the shoulders and the hips.
# The limbs are regions of the crouch (the fore legs below and outside the chest and the fore feet planted ahead under
# the head; the folded hind legs outside the trunk's taper behind), each with a smooth weight so the swing never tears
# the skin; the shoulder and hip pivots are set on the body's side. Colour by region (sRGB palette, faint per-face
# noise and a hashed mottle): olive-grey to greenish brown above, the warts dark ringed in rusty brown (the carried wart
# weight per face: dark at the peak, rusty round it), the thin pale cream mid-dorsal stripe from behind the eyes to the
# vent (the faces on the midline), golden eyes (the faces of each eye bulge) with a dark horizontal pupil (lod0), the big
# oval parotoid glands behind the eyes a little paler, the limbs barred a little darker, the belly pale cream mottled
# grey. Decimates (collapse, X symmetry; the eyes and the stripe kept back) to lod0 ~1,200, lod1 ~400, lod2 ~120
# triangles.
# Rig, the reptile template (as tools/build_salamander.py; the client drives it with the salamanders' slow walk): BODY 0,
# LEG_A 1 (left fore, right hind) and LEG_B 2 (right fore, left hind), pivots at the shoulder and hip; HEAD 6 (pivot at
# the neck, behind the parotoids); a toad has no tail, so TAIL 3 and TAIL_TIP 8 are tiny stub regions at the vent (pivots
# at the vent and just behind it) to keep the template's parts and keys; _BLUE 0 everywhere (the lizard's shader path).
# extras.rig (kind 'reptile'): head, tail, tail_tip, fore, hind, legs, snout_z, vent_z, tail_end_z, belly_y, back_y,
# drop, blue_off, throat_off, length_m. The spine wave is kept tiny: tail_end_z is set 5 snout-vent lengths behind the
# snout (not the vent), so along the body the wave's envelope stays near its snout value (envS) and the toad sways a few
# millimetres rather than bending; length_m is the snout-vent length.
import bpy, bmesh, sys, os, math
from mathutils import Vector
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import animal_glb as A

HEAD_, TAIL, TAIL_TIP = 6, 3, 8

TOAD = dict(
    kind='toad', species='anaxyrus_boreas', name='Western toad', script='tools/build_toad.py',
    job='01a1ae8d-0b79-7550-84cb-9b7d4e6f1127', credits=5,
    tiers=[('lod0', 1200), ('lod1', 400), ('lod2', 120)],
    svl=0.10, width=0.06, back=0.04,
    smooth=0, hind_legs=1.0, snout=1.0, snout_taper=0.0, slim=1.0,
    stripe_half=0.0014,          # m: half-width of the mid-dorsal stripe ribbon (2.8 mm across)
    note='warts found and carried, recoloured, decimated; tail stubs at the vent',
    palette=dict(base=0x6c6a4c, base2=0x6a5c42, wart=0x2e2a22, ring=0x8a4a26, stripe=0xe2d6aa, eye=0xc89a2c, pupil=0x0a0806,
                 parotoid=0x8e8a64, belly=0xd4cab0, belly_spot=0x7a7462, limb_bar=0x4e4a36),
)


def build(cfg, SRC, OUT):
    pal = cfg['palette']; frog = cfg['kind'] == 'frog'
    ob = A.import_glb_mesh(SRC)
    me = ob.data; V = me.vertices
    z0 = min(v.co.z for v in V)
    for v in V: v.co.z -= z0
    me.update()
    adj = A.adjacency(me)
    # Raw frame (source units, Blender axes): x the toad's left, -y forward, z up from the ground (feet and belly at 0);
    # about 1.9 units snout to rump, 1.0 tall at the eyes. Landmarks below were read off side, front and top renders.
    def Z(z): return z - z0            # the renders' and probes' z (the import's frame) -> ground-based z

    # ---- warts on the full mesh: height over the neighbours' mean along the normal, smoothed twice ----
    bump = [0.0] * len(V)
    for v in V:
        nb = adj[v.index]
        if nb:
            m = sum((V[u].co for u in nb), Vector()) / len(nb)
            bump[v.index] = (v.co - m).dot(v.normal)
    for _ in range(2):
        bump = [0.5 * bump[i] + 0.5 * (sum(bump[u] for u in adj[i]) / len(adj[i]) if adj[i] else bump[i]) for i in range(len(V))]
    up_skin = sorted(bump[v.index] for v in V if v.normal.z > -0.2)
    b70, b92 = up_skin[int(0.72 * len(up_skin))], up_skin[int(0.93 * len(up_skin))]
    gw = ob.vertex_groups.new(name='wart')
    for v in V:
        w = A.smooth(b70, b92, bump[v.index]) if v.normal.z > -0.3 else 0.0
        if w > 0: gw.add([v.index], w, 'REPLACE')
    print('INFO wart thresholds', round(b70, 5), round(b92, 5))

    # ---- regions (raw): limbs, head, the vent stubs ----
    NOSE = min(V, key=lambda v: v.co.y).co.copy()
    VENT = Vector((0, 0.92, Z(-0.20)))
    def fore_w(p):
        X = abs(p.x)
        if p.y > -0.06: return 0.0
        a = A.smooth(Z(-0.08), Z(-0.20), p.z) * A.smooth(0.40, 0.47, X)                # the arm, below and outside the chest
        b = A.smooth(0.50, 0.56, X) * A.smooth(Z(0.10), Z(0.0), p.z)                    # the upper arm outside the body
        c = A.smooth(-0.50, -0.58, p.y) * A.smooth(Z(-0.22), Z(-0.32), p.z) * A.smooth(0.14, 0.22, X)   # the planted fore feet
        return max(a, b, c) * A.smooth(-0.06, -0.16, p.y)
    def trunk_half(y): return 0.47 - 0.25 * A.smooth(0.25, 0.85, y)
    def hind_w(p):
        if p.y < -0.05: return 0.0
        T = trunk_half(p.y)
        return A.smooth(T, T + 0.06, abs(p.x)) * A.smooth(Z(0.16), Z(0.04), p.z) * A.smooth(-0.05, 0.05, p.y)
    def stub_w(p):
        if abs(p.x) > 0.14 or p.z > Z(0.02): return 0.0, 0.0
        return A.smooth(0.84, 0.88, p.y), A.smooth(0.90, 0.93, p.y)
    NB = Vector((0, -0.40, Z(0.20)))
    def head_w(p): return A.smooth(-0.36, -0.46, p.y)
    PIV = {(True, True): Vector((0.46, -0.33, Z(0.0))), (False, True): Vector((0.34, 0.62, Z(0.02)))}
    PIV[(True, False)] = Vector((-PIV[(True, True)].x, PIV[(True, True)].y, PIV[(True, True)].z))
    PIV[(False, False)] = Vector((-PIV[(False, True)].x, PIV[(False, True)].y, PIV[(False, True)].z))
    Y_MID = (PIV[(True, True)].y + PIV[(False, True)].y) / 2
    EYE_SRC = Vector((0.21, -0.58, Z(0.43)))
    PAROTOID = (Vector((0.27, -0.36, Z(0.30))), Vector((0.11, 0.17, 0.12)))

    # rig on the full mesh, carried through the collapse in vertex groups
    pg = {n: ob.vertex_groups.new(name=n) for n in ('p1', 'p2', 'p3', 'p6', 'p8')}
    eyeg = ob.vertex_groups.new(name='protect')
    for v in V:
        p = v.co
        fw, hw = fore_w(p), hind_w(p)
        t3, t8 = stub_w(p)
        left = p.x > 0
        if fw > 0 or hw > 0:
            fore = fw >= hw
            part = 1 if fore == left else 2                     # LEG_A: left fore, right hind; LEG_B: right fore, left hind
            pg[f'p{part}'].add([v.index], max(1e-4, max(fw, hw)), 'REPLACE')
        elif t8 > 0: pg['p8'].add([v.index], max(1e-4, t8), 'REPLACE')
        elif t3 > 0: pg['p3'].add([v.index], max(1e-4, t3), 'REPLACE')
        elif head_w(p) > 0: pg['p6'].add([v.index], max(1e-4, head_w(p)), 'REPLACE')
        e = (Vector((abs(p.x), p.y, p.z)) - EYE_SRC).length
        if e < 0.12: eyeg.add([v.index], A.smooth(0.12, 0.05, e), 'REPLACE')

    # ---- variant reshaping (the frog): smoothed skin, longer hind legs, a pointed snout, slimmer ----
    if cfg['smooth']:
        bm = bmesh.new(); bm.from_mesh(me)
        for _ in range(cfg['smooth']): bmesh.ops.smooth_vert(bm, verts=bm.verts, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
        bm.to_mesh(me); bm.free(); me.update()
    HK = cfg['hind_legs'] if isinstance(cfg['hind_legs'], tuple) else (cfg['hind_legs'],) * 3
    if HK != (1.0, 1.0, 1.0):
        for v in V:
            w = hind_w(v.co)
            if w > 0:
                pv = PIV[(False, v.co.x > 0)]; d = v.co - pv
                q = pv + Vector((d.x * HK[0], d.y * HK[1], d.z * HK[2])); q.z = max(0.0, q.z) if v.co.z > 0.02 else v.co.z
                v.co = v.co.lerp(q, w)
    if cfg['snout'] != 1.0 or cfg['snout_taper']:
        for v in V:
            if v.co.y < EYE_SRC.y and fore_w(v.co) < 0.5:
                t = (EYE_SRC.y - v.co.y) / (EYE_SRC.y - NOSE.y)
                v.co.y = EYE_SRC.y + (v.co.y - EYE_SRC.y) * cfg['snout']
                v.co.x *= 1 - cfg['snout_taper'] * t * t
    if cfg.get('folds'):          # the dorsolateral folds: low ridges along each side of the back
        me.update()
        for v in V:
            p = v.co
            if v.normal.z < 0.3 or not -0.45 < p.y < 0.80 or max(fore_w(p), hind_w(p)) > 0.2: continue
            fx = abs(p.x) / max(0.2, trunk_half(p.y) * 0.95)
            p.z += cfg['folds'] * max(0.0, 1 - abs(fx - 0.57) / 0.07) * A.smooth(-0.45, -0.30, p.y) * A.smooth(0.80, 0.62, p.y)
    if cfg['slim'] != 1.0:
        for v in V: v.co.x *= cfg['slim'] + (1 - cfg['slim']) * max(fore_w(v.co), hind_w(v.co))
    me.update()
    NOSE = min(V, key=lambda v: v.co.y).co.copy()

    # ---- scale: snout to vent SVL, the trunk to its width, the back to its height ----
    S = cfg['svl'] / (VENT.y - NOSE.y)
    mid = [v.co for v in V if abs(v.co.y - Y_MID) < 0.05 and fore_w(v.co) == 0 and hind_w(v.co) == 0]
    w_src = max(abs(c.x) for c in mid if c.z > Z(0.0))
    back_src = max(c.z for c in mid)
    XS = cfg['width'] / 2 / (w_src * S); HT = cfg['back'] / (back_src * S)
    yorg = Y_MID
    def sc(p): return Vector((p.x * S * XS, (p.y - yorg) * S, p.z * S * HT))
    def RAW(q): return Vector((q.x / (S * XS), q.y / S + yorg, q.z / (S * HT)))
    for v in V: v.co = sc(v.co)
    me.update()
    piv = {k: sc(p) for k, p in PIV.items()}
    NBm, VENTm, NOSEm, EYEm = sc(NB), sc(VENT), sc(NOSE), sc(EYE_SRC)
    STUB = sc(Vector((0, 0.935, VENT.z)))
    back_mid = max(v.co.z for v in V if abs(v.co.x) < 0.002 and abs(v.co.y) < 0.004)
    belly = min(v.co.z for v in V if abs(v.co.x) < 0.004 and abs(v.co.y) < 0.006)
    print('LANDMARKS svl', round(VENTm.y - NOSEm.y, 4), 'trunk width', round(2 * w_src * S * XS, 4), 'back at mid', round(back_mid, 4),
          'belly', round(belly, 4), 'length (bbox)', round(max(v.co.y for v in V) - NOSEm.y, 4), 'span', round(2 * max(abs(v.co.x) for v in V), 4),
          'top', round(max(v.co.z for v in V), 4), 'eye', [round(x, 4) for x in EYEm], 'neck', [round(x, 4) for x in NBm],
          'vent', [round(x, 4) for x in VENTm], 'scale', round(S, 5), 'x', round(XS, 3), 'z', round(HT, 3),
          'pivots', {('F' if k[0] else 'H') + ('L' if k[1] else 'R'): [round(x, 4) for x in p] for k, p in piv.items()})

    # ---- colour ----
    def hsh(c, cell): return A.hash01(abs(c.x) // cell, c.y // cell, c.z // cell)
    def region(p, R, W, far, WF=(), RF=()):
        c = p.center; n = p.normal; r = RAW(c)
        parts = [R[i]['part'] for i in p.vertices]
        limb = sum(1 for x in parts if x in (1, 2)) * 2 > len(parts)
        e = (Vector((abs(r.x), r.y, r.z)) - EYE_SRC).length
        if e < 0.075 and n.z > -0.2 and (abs(n.x) > 0.25 or n.z > 0.5) and not limb: return pal['eye']
        wart = sum(W[i] for i in p.vertices) / len(p.vertices)
        if n.z < -0.45 or (r.z < 0.035 and not limb and n.z < 0.2):                        # belly
            if frog: return pal['belly'] if not (r.y > 0.2 and limb) else pal['thigh_under']
            return pal['belly_spot'] if hsh(c, 0.004) < 0.22 else pal['belly']
        if frog:
            if limb and r.y > Y_MID and n.z < 0.0: return pal['thigh_under']                # yellow under the hind legs
            ej = r - Vector((0, EYE_SRC.y, EYE_SRC.z))
            if abs(n.x) > 0.35 and not limb and -0.30 < ej.z < -0.04 and -0.02 < ej.y < 0.30: return pal['mask']   # the dark mask behind the eye
            if abs(n.x) > 0.35 and not limb and -0.44 < ej.z <= -0.30 and -0.30 < ej.y < 0.30: return pal['jaw']   # the pale jaw stripe below it
            fx = abs(r.x) / max(0.2, trunk_half(r.y) * 0.95)
            if not limb and -0.45 < r.y < 0.80 and 0.48 < fx < 0.66 and n.z > 0.25: return pal['fold']   # dorsolateral folds
            if hsh(c, 0.0035) < pal['spot_frac'] and (n.z > 0.2 or limb): return pal['spot']   # crisp black spots
            return pal['base2'] if hsh(c, 0.010) < 0.35 else pal['base']
        pc, pr = PAROTOID
        q = Vector((abs(r.x), r.y, r.z)) - pc
        if (q.x / pr.x) ** 2 + (q.y / pr.y) ** 2 + (q.z / pr.z) ** 2 < 1 and n.z > -0.1:
            return pal['wart'] if p.index in WF else pal['parotoid']
        if p.index in WF: return pal['wart']
        if p.index in RF: return pal['ring']
        if limb and hsh(c, 0.006) < 0.25: return pal['limb_bar']
        return pal['base2'] if hsh(c, 0.010) < 0.4 else pal['base']

    def pupils():
        """A dark horizontal pupil on each golden eye (lod0): a flat octahedron on the eye's outward face."""
        tris = []
        for s in (1, -1):
            q = Vector((s * EYEm.x, EYEm.y, EYEm.z))
            h = BVH.ray_cast(q + Vector((s * 0.02, 0, 0.004)), Vector((-s, 0, -0.2)).normalized())[0]
            c = (h if h is not None else q) + Vector((s * 0.0004, 0, 0))
            rr = Vector((0.0005, 0.0026, 0.0011)) * (cfg['svl'] / 0.10)
            P = [c + Vector((rr.x, 0, 0)), c - Vector((rr.x, 0, 0)), c + Vector((0, rr.y, 0)), c - Vector((0, rr.y, 0)), c + Vector((0, 0, rr.z)), c - Vector((0, 0, rr.z))]
            for a, b in ((0, 2), (2, 1), (1, 3), (3, 0)):
                for apex in (4, 5): tris.append((P[a], P[b], P[apex], c))
        return tris
    from mathutils.bvhtree import BVHTree
    bpy.context.view_layer.update()
    BVH = BVHTree.FromObject(ob, bpy.context.evaluated_depsgraph_get())

    def stripe(n, bvh):
        """The thin pale cream mid-dorsal stripe: a ribbon laid 0.3 mm over the back along the midline from behind the eyes
        to the vent (n stations; each edge cast down onto the skin), the head part's weight on it ahead of the neck."""
        out = []
        if n < 2: return out
        y0, y1 = -0.47, 0.84
        rows = []
        for k in range(n):
            u = k / (n - 1); yr = y0 + (y1 - y0) * u
            hw = cfg['stripe_half'] * (0.35 + 0.65 * A.smooth(0.0, 0.12, u)) * (1 - 0.6 * A.smooth(0.75, 1.0, u))
            ym = (yr - yorg) * S; row = []
            for sx in (-1, 0, 1):
                h = bvh.ray_cast(Vector((sx * hw, ym, 0.2)), Vector((0, 0, -1)))
                if h[0] is None: row = None; break
                row.append(h[0] + Vector((0, 0, 0.0004)))
            if row: rows.append((row, head_w(Vector((0, yr, 0)))))
        for (r0, w0), (r1, w1) in zip(rows, rows[1:]):
            for a, b, c, wa in ((r0[0], r0[2], r1[2], (w0, w0, w1)), (r0[0], r1[2], r1[0], (w0, w1, w1))):
                if (b - a).cross(c - a).z < 0: b, c = c, b; wa = (wa[0], wa[2], wa[1])
                out.append((a, b, c, pal['stripe'], HEAD_, wa, NBm))
        return out

    tiers = []
    for name, target in cfg['tiers']:
        extra = pupils() if name == 'lod0' else []
        nst = {'lod0': 26, 'lod1': 10, 'lod2': 0}[name] if not frog else 0
        body_t = target - len(extra) - 2 * max(0, nst - 1)
        o, n0 = A.tier_copy(ob, body_t, protect='protect', protect_factor=0.7 if name != 'lod2' else 0.3)
        m = o.data
        if len(m.polygons) > body_t * 1.04:      # the symmetric collapse stalls short of a small target: finish without it
            d = o.modifiers.new('dec', 'DECIMATE'); d.decimate_type = 'COLLAPSE'; d.ratio = body_t / len(m.polygons); d.use_collapse_triangulate = True
            bpy.ops.object.modifier_apply(modifier='dec'); A.triangulate(m)
        bpy.context.view_layer.update()
        TB = BVHTree.FromObject(o, bpy.context.evaluated_depsgraph_get())
        gi = {g.index: g.name for g in o.vertex_groups}
        R = {}; W = {}
        for v in m.vertices:
            w = {gi[g.group]: g.weight for g in v.groups}
            W[v.index] = w.get('wart', 0.0)
            pid = max((k for k in ('p1', 'p2', 'p3', 'p6', 'p8') if k in w), key=lambda k: w[k], default=None)
            if pid is None: R[v.index] = dict(part=0, partw=0.0, pivot=Vector(), blue=0.0); continue
            part = int(pid[1:]); co = v.co
            if part in (1, 2): pv = piv[(co.y < 0, co.x > 0)]
            else: pv = {HEAD_: NBm, TAIL: VENTm, TAIL_TIP: STUB}[part]
            R[v.index] = dict(part=part, partw=min(1.0, w[pid]), pivot=pv, blue=0.0)
        far = name == 'lod2'
        WF, RF = set(), set()
        RING_P = {'lod0': 0.7, 'lod1': 0.3, 'lod2': 0.0}[name]          # bigger faces on the far tiers: fewer rusty rings
        if not frog:     # the warts: faces at a carried wart peak (or a hashed few) on the back, flanks and limbs; their
                         # neighbours ring them rusty
            vf = {}
            for p in m.polygons:
                for i in p.vertices: vf.setdefault(i, []).append(p.index)
            for p in m.polygons:
                r = RAW(p.center)
                if p.normal.z < -0.1 or r.z < Z(-0.36) or r.y < EYE_SRC.y - 0.06: continue
                if (Vector((abs(r.x), r.y, r.z)) - EYE_SRC).length < 0.11: continue
                if r.y < -0.40 and r.z < Z(0.25): continue                                  # not the jaw and lips
                if max(W[i] for i in p.vertices) > 0.8 or hsh(p.center, 0.005) < 0.11: WF.add(p.index)
            areas = sorted(p.area for p in m.polygons); amed = areas[len(areas) // 2]
            for f in WF:
                for i in m.polygons[f].vertices:
                    for g in vf[i]:
                        G_ = m.polygons[g]
                        if g not in WF and G_.area < 2.2 * amed and G_.normal.z > -0.1 and hsh(G_.center, 0.003) < RING_P: RF.add(g)
        t = A.emit(m, lambda p: tuple(A.grizzle(region(p, R, W, far, WF, RF), p.center, 0.06, 0.0015)), lambda i: R[i], extra_names=('blue',))
        for a, b, c, h, part, w, pv in stripe(nst, TB):
            col = A.srgb2lin(h)
            for q, wq in zip((a, b, c), w):
                t['idx'].append(len(t['pos'])); t['pos'].append(A.to3(q)); t['col'].append(col)
                t['part'].append(float(part if wq > 0 else 0)); t['partw'].append(float(wq)); t['piv'].append(A.to3(pv if wq > 0 else Vector())); t['blue'].append(0.0)
        nb = len(t['idx']) // 3
        pc = A.srgb2lin(pal['pupil'])
        for a, b, c, ctr in extra:
            if (b - a).cross(c - a).dot((a + b + c) / 3 - ctr) < 0: b, c = c, b
            for q in (a, b, c):
                t['idx'].append(len(t['pos'])); t['pos'].append(A.to3(q)); t['col'].append(pc)
                t['part'].append(float(HEAD_)); t['partw'].append(1.0); t['piv'].append(A.to3(NBm)); t['blue'].append(0.0)
        print('TIER', name, len(t['idx']) // 3, 'triangles (body', nb, ', pupils', len(extra), ') from', n0)
        bpy.data.objects.remove(o)
        tiers.append((name, t))

    r4 = lambda p: [round(x, 4) for x in A.to3(p)]
    snout_z = round(-NOSEm.y, 4)
    A.write_glb(OUT, tiers, f"wild-earth {cfg['script']} (Blender)",
                f"{cfg['name']}{' (a variant of the western toad)' if cfg.get('variant_of') else ''} generated with Meshy (meshy.ai), text-to-3D preview task {cfg['job']}, owned by the account holder (Aaron Brodeur), for Wild Earth; CC BY-SA 4.0; {cfg['note']} by wild-earth {cfg['script']}",
                extra_names=('blue',),
                extras={'rig': {'kind': 'reptile', 'head': r4(NBm), 'tail': r4(VENTm), 'tail_tip': r4(STUB),
                                'fore': r4(piv[(True, True)]), 'hind': r4(piv[(False, True)]),
                                'legs': {'FL': r4(piv[(True, True)]), 'FR': r4(piv[(True, False)]), 'HL': r4(piv[(False, True)]), 'HR': r4(piv[(False, False)])},
                                'snout_z': snout_z, 'vent_z': round(-VENTm.y, 4), 'tail_end_z': round(snout_z - 5 * cfg['svl'], 4),
                                'belly_y': round(max(belly, 0.001), 4), 'back_y': round(back_mid, 4), 'drop': round(max(belly, 0.0) * 0.85, 4),
                                'blue_off': [round(x, 4) for x in A.srgb2lin(pal['belly'])], 'throat_off': [round(x, 4) for x in A.srgb2lin(pal['belly'])],
                                'length_m': cfg['svl']},
                        'species': cfg['species'], 'svl_m': cfg['svl'], 'height_scale': round(HT, 3), 'width_scale': round(XS, 3),
                        'meshy_task': cfg['job'], **({'variant_of': cfg['variant_of']} if cfg.get('variant_of') else {}),
                        'wave_note': 'tail_end_z is 5 snout-vent lengths behind the snout (no tail): the spine wave stays near its snout envelope, a sway of a few mm',
                        'source': {'kind': 'variant' if cfg.get('variant_of') else 'meshy', 'job_id': cfg['job'], 'ai_model': 'meshy-6-lite',
                                   'mode': 'text-to-3d preview', 'ai_generated': True, 'credit': 'generated with Meshy (meshy.ai)',
                                   'meshy_metadata': 'none embedded in the source GLB', 'credits': 0 if cfg.get('variant_of') else cfg['credits'],
                                   **({'variant_of': cfg['variant_of']} if cfg.get('variant_of') else {})},
                        'parts': 'reptile template: BODY 0, LEG_A 1 (left fore, right hind), LEG_B 2 (right fore, left hind), pivots at the shoulder and hip; HEAD 6 (pivot at the neck); TAIL 3 and TAIL_TIP 8 tiny stubs at the vent (no tail); _BLUE 0 everywhere (kept for the shader path)'})


if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:]
    build(TOAD, argv[0], argv[1])
