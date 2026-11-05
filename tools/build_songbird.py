# Build the Hoh rain forest's perching birds on the Steller's jay's bird template (tools/build_stellersjay.py), one
# species per run, from Meshy text-to-3D previews: the Pacific wren, the Canada (gray) jay, the chestnut-backed
# chickadee, the barred owl and the belted kingfisher.
#
# Sources: Meshy (meshy.ai) text-to-3D previews, ai_model meshy-6-lite, untextured triangle meshes (about 20,800
#   triangles each, one piece), 2026-11-05 UTC, 5 credits each; job records in
#   library/animals/jobs/<species>/<task>/job.json. Tasks and prompts:
#   troglodytes_pacificus 01a1ad36-efb8-739e-b621-93b82701cc36: "A Pacific wren (Troglodytes pacificus), a tiny round
#     dark brown songbird about 10 cm long, NOT a sparrow, NOT a mouse. One adult standing on the ground, side-on pose,
#     body round like a ball, a very short stubby tail cocked straight up, a thin short slightly downcurved bill, a short
#     neck, thin pale pinkish-brown legs, three toes forward and one back. Dark rufous-brown all over with fine black
#     barring on the wings, tail and flanks, a faint pale buff eyebrow. Wings folded tight against the body. No base, no
#     perch. Game-ready, clean closed mesh."
#   perisoreus_canadensis 01a1ad38-feb3-7224-b473-535085890e02: "A Canada jay (gray jay, Perisoreus canadensis) of the
#     Pacific Northwest, one adult bird perched with its wings folded tight against the body, side-on pose. NOT a blue
#     jay, no crest. Realistic proportions, about 29 cm long with a long tail; a fluffy rounded body, a round head, a
#     short stubby black bill. Soft grey back, wings and tail, a white forehead, throat and collar, a dark grey cap on
#     the back of the head, a pale grey-white belly. Dark legs, three toes forward and one back. No base, no perch.
#     Game-ready, clean closed mesh."
#   poecile_rufescens 01a1ad39-ae77-7764-bea5-e718f3527f65: "A chestnut-backed chickadee (Poecile rufescens), a tiny
#     songbird about 11 cm long, one adult perched with its wings folded tight against the body, side-on pose. A round
#     fluffy body, a big round head, a tiny short black bill, a medium-long narrow tail. A sooty dark brown cap and a
#     black bib, bright white cheeks, a rich chestnut back and flanks, grey wings and tail, a white belly. Thin dark
#     legs, three toes forward and one back. No base, no perch. Game-ready, clean closed mesh."
#   strix_varia 01a1ad38-4e76-7191-8ddc-c7409132af60: "A barred owl (Strix varia), one adult perched upright, side-on
#     pose, wings folded against the body. Realistic proportions: 50 cm long, a big round head with NO ear tufts, a pale
#     grey-brown facial disc with concentric dark rings, large dark brown eyes, a small yellow hooked bill, a stocky
#     body, a medium tail. Grey-brown plumage with white bars across the back and wings, horizontal brown bars across
#     the upper breast and vertical brown streaks on the pale belly; feathered legs and feet with dark talons. No base,
#     no perch, no branch. Game-ready, clean closed mesh."
#   megaceryle_alcyon 01a1ad3b-e93c-70a8-bea3-372512334673: "A belted kingfisher (Megaceryle alcyon), one adult perched
#     upright with its wings folded tight, side-on pose. Realistic proportions: 32 cm long, a large head with a shaggy
#     ragged crest at the back of the crown, a long heavy straight dagger-shaped black bill as long as the head, a
#     stocky body, a short square tail, tiny legs. Slate blue-grey head, back and wings and a blue-grey band across the
#     breast, a white collar around the neck, a white spot in front of the eye, white underparts; small white spots on
#     the dark wing tips. No base, no perch. Game-ready, clean closed mesh."
# Licence: generated through the Meshy API on the account holder's paid plan, so the output is owned by the account
#   holder (Meshy Terms of Use 3.2, https://www.meshy.ai/terms-of-use, last updated 2026-09-19) and released with the
#   project's assets under CC BY-SA 4.0. Credit: "generated with Meshy (meshy.ai)". Terms 2.4: AI-identifying metadata
#   Meshy embeds is carried over; these files carried none (asset.generator only, which is kept in extras.source).
#
# Rebuild (Blender 4.1; run from the repo root), one species per run:
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/build_songbird.py -- \
#       library/animals/jobs/<species>/<task>/model.glb client/assets/<name>.glb --species <species> [--preview /tmp/p]
#   troglodytes_pacificus -> pacific_wren.glb, perisoreus_canadensis -> gray_jay.glb, poecile_rufescens ->
#   chickadee.glb, strix_varia -> barred_owl.glb, megaceryle_alcyon -> kingfisher.glb (the task folders are above).
#
# What it does, per species (the RECIPES below; raw coordinates are the source's, Blender axes, ~1.9 units long):
# cuts the generated tail, legs (and the kingfisher's rock base) away and fills the holes; reshapes where the preview
# is off (the wren's body shortened to a ball; the owl's head widened); pitches the body about the hips; scales to
# the true size (bill tip to rump along the neck, plus the tail, or the owl's height); adds a procedural tail lofted
# at the species' angle (the wren's short and cocked 50 degrees up, the gray jay's long and rounded, the chickadee's
# short and square, the owl's and kingfisher's angled down behind the upright body, as steeply as keeps the tip off the
# ground: 47 and 35 degrees below level), procedural legs (the owl's
# feathered, with dark talons), eyes, the owl's yellow bill, and flight wing cards (arm and hand per side, shaped and
# barred per species) that collapse into the shoulder when the bird is perched or on the ground; recolours by region
# from field-guide sRGB, with face bands for the barring on lod0 and a faint per-face grizzle. The kingfisher carries a
# second colour set (_COLORB): the file's COLOR_0 is the female (a rufous belly band and flanks), _COLORB the male (white
# there). Tiers lod0 ~1,000, lod1 ~400, lod2 ~120 triangles (the owl ~1,400 / 500 / 150), body decimated (the head kept back) with Blender
# collapse, X symmetry. Rig: the Steller's jay's bird template (animalModels.js PART): BODY 0, LEG_A 1 / LEG_B 2
# (pivot at the knee), TAIL 3 (pivot at the rump), HEAD 6 (head and neck, pivot at the base of the neck), WING_L/R 4/5
# and HAND_L/R 9/10 cards; extras.rig {kind 'bird', wing, tail, head, length_m} as the Steller's jay's. Origin on the
# ground between the feet.
# Output: one GLB with meshes lod0, lod1, lod2 (POSITION, COLOR_0 linear, _PART, _PARTW, _PIVOT, indices; the
# kingfisher also _COLORB).
# --preview <prefix>: renders lod0 (side, front, top, three-quarter, head; workbench, vertex colour) into one PNG.
import bpy, bmesh, sys, os, math, json, struct
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import animal_glb as A

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, OUT = argv[0], argv[1]
opt = lambda k, d: argv[argv.index(k) + 1] if k in argv else d
PREVIEW = opt('--preview', None)
SPECIES = opt('--species', None)

# Part ids (animalModels.js PART)
BODY, LEG_A, LEG_B, TAIL, WING_L, WING_R, HEAD, HAND_L, HAND_R = 0, 1, 2, 3, 4, 5, 6, 9, 10
smooth, mix = A.smooth, A.mix
V3 = lambda x, y, z: Vector((x, y, z))


def bars(v, period, duty, phase=0.0):
    """True in the dark part of a band pattern along v."""
    return ((v + phase) / period) % 1.0 < duty


def side(n, k=0.35): return abs(n.x) > k


# ---------------------------------------------------------------------------------------------------------------
# Recipes. Raw points are the source's (Blender axes, before reshape and pitch). Metres after placement. Colour
# functions get (raw position, raw normal, level) and return an sRGB hex (or a (female, male) pair, the kingfisher).
# ---------------------------------------------------------------------------------------------------------------
def wren():
    UP, BROWN, UNDER, THROAT = 0x462e1d, 0x583823, 0x62422b, 0x765539
    BAR, BUFF, BROW, BILL = 0x1e140c, 0x9c7c58, 0x9a7c5c, 0x2c241e
    EYE = V3(0, -0.68, 0.544)
    def lower(y): return 0.03 - 0.22 * (y + 0.32)        # the folded wing's lower edge
    def col(r, n, lv, hw):
        if r.y < -0.78 and r.z > 0.53: return BILL
        if hw > 0.5:
            if side(n, 0.6) and -0.78 < r.y < -0.52 and EYE.z + 0.03 < r.z < EYE.z + 0.07 - 0.08 * (r.y + 0.68): return mix(UP, BROW, 0.7)
            if n.z > 0.2 or r.z > EYE.z + 0.03: return UP
            if r.z < EYE.z - 0.07 and n.z < 0.2 and not side(n, 0.75): return THROAT
            return BROWN
        if side(n) and -0.40 < r.y < 0.32 and lower(r.y) < r.z < 0.38 - 0.4 * (r.y + 0.4):  # folded wing, barred
            return mix(BROWN, BAR, 0.5) if lv == 0 and bars(r.y, 0.1, 0.4) else BROWN
        if n.z > 0.25: return UP
        if r.y < -0.40 and r.z > 0.0: return THROAT if r.z > 0.15 else UNDER                # breast, plain
        if lv == 0:                                                                        # belly and flanks, barred
            return mix(UNDER, BAR, 0.4) if bars(r.y + 0.3 * r.z, 0.11, 0.4) else mix(UNDER, BUFF, 0.3)
        return UNDER
    def tcol(t, lv):
        if lv == 0 and 0.1 < t < 0.98 and bars(t, 0.2, 0.42, 0.1): return BAR, BAR
        return BROWN, UNDER
    def wcol(u, lv): return (BAR if lv == 0 and bars(u, 0.25, 0.3, 0.1) else BROWN), 0x7a5c44
    def hcol(v, lv): return (BAR if lv == 0 and bars(v, 0.28, 0.3, 0.05) else BROWN), 0x7a5c44
    return dict(
        common='Pacific wren', name='pacific_wren', job='01a1ad36-efb8-739e-b621-93b82701cc36',
        length=0.10, tail_m=0.028, mass=0.009, tris=[1000, 400, 120],
        cut=lambda p: p.y > 0.30 or p.z < -0.27,
        reshape=[(lambda p: V3(p.x, p.y if p.y < -0.45 else -0.45 + (p.y + 0.45) * 0.84, p.z),
                  lambda p: V3(p.x, p.y if p.y < -0.45 else -0.45 + (p.y + 0.45) / 0.84, p.z))],
        hip=V3(0, -0.12, -0.10), pitch=8.0, belly=V3(0, -0.12, -0.27),
        neck=V3(0, -0.55, 0.36), head_dir=V3(0, -0.6, 0.8), head_band=(-0.02, 0.06),
        rump=V3(0, 0.25, 0.10), tail_dir=V3(0, 1, 0.3), eye=EYE,
        shoulder=V3(0, -0.40, 0.30), shoulder_x=0.009,
        legs=dict(knee_h=0.022, belly_h=0.016, legx=0.0085, u=0.45, col=0xa07866),
        eye_r=(0.0010, 0.0016, 0.0017),
        tail=dict(angle=50.0, w0=0.0055, w1=0.0085, ridge=0.002, tip='round', n0=10, col=tcol),
        wing=dict(span=0.15, chord=1.15, hand='round', arm=wcol, hand_col=hcol, top=BROWN, under=0x7a5c44),
        color=col, grizzle=0.07)


def grayjay():
    WHITE, CAP, GREY, WING, WTIP = 0xe4e2dc, 0x3a3531, 0x7a756e, 0x6c6862, 0xb0aca4
    UNDER, BILL, UNDERW = 0xbcb9b2, 0x141414, 0xa8a49c
    EYE = V3(0, -0.71, 0.40)
    def lower(y): return 0.06 - 0.25 * (y + 0.35)
    def col(r, n, lv, hw):
        if r.y < -0.79 and 0.31 < r.z < 0.42: return BILL
        if hw > 0.5:
            if side(n, 0.4) and -0.70 < r.y < -0.60 and abs(r.z - EYE.z) < 0.035: return CAP     # behind the eye
            if (r.z > EYE.z + 0.03 and r.y > -0.70) or (r.y > -0.62 and r.z > EYE.z - 0.04 and n.z > -0.3): return CAP
            return WHITE
        if r.y < -0.30 and r.z > 0.31 - 0.1 * (r.y + 0.5) and n.z > -0.3 and not side(n, 0.8):        # the nape, dark
            return CAP if r.y < -0.38 else mix(CAP, GREY, 0.5)
        if r.y < -0.30 and r.z > 0.22 and n.z > -0.3 and side(n, 0.5): return mix(WHITE, GREY, 0.25)        # collar sides
        if side(n) and -0.40 < r.y < 0.20 and r.z > lower(r.y) and n.z < 0.6:                      # folded wing
            return mix(WING, WTIP, 0.5) if lv == 0 and bars(r.y, 0.12, 0.25, 0.02) and r.y > -0.2 else WING
        if n.z > 0.25: return GREY
        if r.y < -0.55 and r.z > 0.10: return mix(WHITE, UNDER, 0.4)                                 # upper breast
        if side(n, 0.5): return mix(GREY, UNDER, 0.55)                                               # the flanks
        return UNDER
    def tcol(t, lv):
        if t > 0.93: return WTIP, UNDERW
        return GREY, UNDERW
    def wcol(u, lv): return (WTIP if lv == 0 and u > 0.86 else WING), UNDERW
    def hcol(v, lv): return (WTIP if lv == 0 and v > 0.9 else mix(WING, 0x3a3631, 0.25)), UNDERW
    return dict(
        common='Canada jay', name='gray_jay', job='01a1ad38-feb3-7224-b473-535085890e02',
        length=0.29, tail_m=0.13, mass=0.07, tris=[1000, 400, 120],
        cut=lambda p: p.y > 0.17 or p.z < -0.275,
        reshape=[],
        hip=V3(0, -0.05, -0.10), pitch=4.0, belly=V3(0, -0.06, -0.275),
        neck=V3(0, -0.52, 0.28), head_dir=V3(0, -0.8, 0.6), head_band=(-0.03, 0.07),
        rump=V3(0, 0.15, 0.15), tail_dir=V3(0, 1, 0.1), eye=EYE,
        shoulder=V3(0, -0.40, 0.22), shoulder_x=0.028,
        legs=dict(knee_h=0.040, belly_h=0.029, legx=0.018, u=0.9, col=0x18181a),
        eye_r=(0.0017, 0.0028, 0.003),
        tail=dict(angle=-8.0, w0=0.011, w1=0.021, ridge=0.005, tip='round', n0=6, col=tcol),
        wing=dict(span=0.45, chord=1.08, hand='round', arm=wcol, hand_col=hcol, top=WING, under=UNDERW),
        color=col, grizzle=0.06)


def chickadee():
    CAP, BIB, CHEEK, CHEST, WING = 0x3b2f27, 0x131212, 0xf0eee8, 0x8a3f22, 0x686a6e
    EDGE, BELLY, FLANK, TAILC, BILL = 0xa9aba8, 0xe4e0d6, 0x9a5434, 0x67696d, 0x161616
    EYE = V3(0, -0.755, 0.367)
    def lower(y): return 0.06 - 0.1 * (y + 0.3)
    def capz(y): return EYE.z - 0.03 - 0.35 * max(0.0, y - EYE.y - 0.08)
    def col(r, n, lv, hw):
        if r.y < -0.83 and 0.27 < r.z < 0.38: return BILL
        bib = abs(r.x) < 0.17 - 0.2 * max(0.0, 0.25 - r.z) and r.y < -0.50 and n.y < -0.1 and 0.10 < r.z < EYE.z - 0.11
        if hw > 0.5:
            if r.z > capz(r.y): return CAP
            if bib: return BIB
            return CHEEK
        if r.y < -0.40 and r.z > capz(r.y) and n.z > 0: return CAP                                   # the nape
        if bib: return BIB
        if r.y < -0.38 and r.z > 0.16 and side(n, 0.45): return CHEEK                               # cheek to the neck side
        if side(n) and -0.42 < r.y < 0.36 and r.z > lower(r.y) and n.z < 0.6:                       # folded wing, pale edges
            return EDGE if lv == 0 and (r.z < lower(r.y) + 0.04 or bars(r.z, 0.09, 0.22)) else WING
        if n.z > 0.2: return CHEST
        if side(n, 0.3) and r.y > -0.5: return FLANK
        return BELLY
    def tcol(t, lv): return TAILC, mix(TAILC, EDGE, 0.4)
    def wcol(u, lv): return (EDGE if lv == 0 and bars(u, 0.25, 0.25, 0.2) else WING), 0x9a9c9e
    def hcol(v, lv): return (EDGE if lv == 0 and bars(v, 0.33, 0.2, 0.1) else WING), 0x9a9c9e
    return dict(
        common='Chestnut-backed chickadee', name='chickadee', job='01a1ad39-ae77-7764-bea5-e718f3527f65',
        length=0.115, tail_m=0.05, mass=0.01, tris=[1000, 400, 120],
        cut=lambda p: p.y > 0.36 or p.z < -0.265,
        reshape=[],
        hip=V3(0, -0.08, -0.10), pitch=0.0, belly=V3(0, -0.08, -0.265),
        neck=V3(0, -0.55, 0.25), head_dir=V3(0, -0.75, 0.66), head_band=(-0.03, 0.07),
        rump=V3(0, 0.33, 0.0), tail_dir=V3(0, 1, -0.3), eye=EYE,
        shoulder=V3(0, -0.42, 0.22), shoulder_x=0.01,
        legs=dict(knee_h=0.02, belly_h=0.014, legx=0.008, u=0.45, col=0x3a3a3e),
        eye_r=(0.0011, 0.0017, 0.0018),
        tail=dict(angle=-14.0, w0=0.0065, w1=0.0095, ridge=0.002, tip='square', n0=4, col=tcol),
        wing=dict(span=0.20, chord=1.1, hand='round', arm=wcol, hand_col=hcol, top=WING, under=0x9a9c9e),
        color=col, grizzle=0.06)


def owl():
    GB, PALE, DISC, RING, RIM = 0x6b5b4b, 0xddd5c6, 0xc8bca9, 0x806a54, 0x4a3a2c
    WHITE, STREAK, BILLC, LEG, TALON = 0xe4ded2, 0x5e4634, 0xe2c444, 0xb9ab94, 0x2a2420
    EYES = [V3(0.13, -0.36, 0.744), V3(-0.13, -0.36, 0.744)]
    BAR_GB = mix(GB, PALE, 0.55)
    def col(r, n, lv, hw):
        front = n.y < -0.35
        if hw > 0.5:
            if front and r.y < -0.18 and r.z > 0.47:                                                  # the facial disc
                if abs(r.x) < 0.035 and 0.60 < r.z < 0.71: return BILLC
                d = min(math.hypot(r.x - e.x, r.z - e.z) for e in EYES)
                if abs(r.x) > 0.255 or r.z > 0.905 or d > 0.215: return RIM
                if abs(r.x) < 0.03: return mix(DISC, WHITE, 0.4)                                      # pale between the eyes
                if d < 0.055: return RING                                                             # dark round the eye
                if lv <= 1 and bars(d - 0.055, 0.06, 0.35, -0.02): return RING                         # concentric rings
                return DISC
            if lv == 0 and bars(r.y if n.z > 0.6 else r.z, 0.09, 0.3): return BAR_GB                  # crown and nape bars
            return GB
        if front and r.y < -0.12 and abs(r.x) < 0.27:
            if r.z > 0.15:                                                                            # the ruff, barred across
                return STREAK if lv <= 1 and bars(r.z, 0.09, 0.45) else WHITE
            return STREAK if lv <= 1 and bars(abs(r.x), 0.12, 0.3, 0.02) else WHITE                    # belly, streaked down
        if lv == 0 and bars(r.z + 0.2 * abs(r.x), 0.12, 0.3): return BAR_GB                             # back and folded wings
        if lv == 1 and bars(r.z, 0.16, 0.25): return mix(GB, PALE, 0.4)
        return GB
    def tcol(t, lv):
        if lv == 0 and 0.08 < t < 0.97 and bars(t, 0.2, 0.38, 0.12): return PALE, 0xe0d8c8
        return GB, 0xb8ac98
    def wcol(u, lv):
        dark = lv == 0 and bars(u, 0.2, 0.4, 0.05)
        return (PALE if dark else GB), (0xa89a86 if dark else 0xe6dfd2)
    def hcol(v, lv):
        dark = lv == 0 and bars(v, 0.2, 0.4, 0.05)
        return (PALE if dark else GB), (0x9a8a76 if dark else 0xe6dfd2)
    return dict(
        common='Barred owl', name='barred_owl', job='01a1ad38-4e76-7191-8ddc-c7409132af60',
        length=0.48, height=0.50, tail_m=0.12, mass=0.7, tris=[1400, 500, 150],
        cut=lambda p: p.z < -0.53,
        reshape=[(lambda p: owl_head(p, 1), lambda p: owl_head(p, -1))],
        hip=V3(0, 0.05, -0.30), pitch=10.0, belly=V3(0, 0.0, -0.53),
        neck=V3(0, -0.05, 0.42), head_dir=V3(0, -0.2, 0.98), head_band=(-0.03, 0.06),
        rump=V3(0, 0.32, -0.40), tail_dir=V3(0, 0.5, -0.85), eye=EYES[0], eye_front=True,
        shoulder=V3(0, 0.06, 0.32), shoulder_x=0.065,
        legs=dict(knee_h=0.062, belly_h=0.045, legx=0.035, u=1.7, col=LEG, toe=LEG, talon=TALON, feathered=True),
        eye_r=(0.0135, 0.003, 0.0135), eye_col=0x160e0a,
        bill=dict(at=V3(0, -0.37, 0.66), dir=V3(0, -0.6, -0.8), length=0.018, radius=0.005, col=BILLC),
        tail=dict(angle=-55.0, w0=0.035, w1=0.05, ridge=0.008, tip='round', n0=8, col=tcol),
        wing=dict(span=1.05, chord=1.3, hand='broad', arm=wcol, hand_col=hcol, top=GB, under=0xe0d8ca),
        color=col, grizzle=0.06)


def owl_head(p, sgn):
    """The barred owl's head widened 1.15x (x and y about the neck axis) above the neck; z-only weight (invertible)."""
    k = 1 + 0.15 * smooth(0.36, 0.50, p.z)
    if sgn < 0: k = 1 / k
    return V3(p.x * k, -0.05 + (p.y + 0.05) * k, p.z)


def kingfisher():
    SLATE, WHITE, RUF, BILLC, BILLB, BLACK = 0x50657c, 0xeeeeea, 0xa14c26, 0x18181a, 0x6e7276, 0x1b1b20
    EYE = V3(0, -0.122, 0.611)
    def zline(y): return 0.37 + 0.12 * (y + 0.15) / 0.75        # the collar's lower edge (front low, back high)
    def col(r, n, lv, hw):
        if r.y < -0.30 and 0.52 < r.z < 0.70:                                                       # the bill
            return BILLB if r.y > -0.42 and n.z < 0.3 else BILLC
        zl = zline(r.y)
        if zl < r.z < zl + 0.085 and (hw < 0.9 or r.z < 0.50): return WHITE                           # the collar, all round
        if hw > 0.5:
            if side(n, 0.4) and -0.26 < r.y < -0.17 and 0.615 < r.z < 0.69: return WHITE             # spot before the eye
            if r.y < 0.12 and r.z < 0.55 - 0.25 * (r.y + 0.30) and n.z < 0.4: return WHITE             # chin and throat
            return SLATE
        front = n.y < -0.2 or n.z < -0.5
        wing = side(n, 0.4) and r.y > 0.05 and not front
        if wing and r.y > 0.50 and r.z < -0.12:                                                       # primaries, white-spotted
            return (WHITE if lv == 0 and A.hash01(abs(r.x) // 0.03, r.y // 0.03, r.z // 0.03) < 0.16 else BLACK)
        if front and not wing:
            if r.z > zl - 0.17: return SLATE                                                          # the breast band
            if zl - 0.41 < r.z < zl - 0.24: return (RUF, WHITE)                                       # her belly band
            if r.z < zl - 0.25 and side(n, 0.75): return (RUF, WHITE)                                 # her flanks
            return WHITE
        if side(n, 0.55) and r.z < zl - 0.30 and r.y < 0.35 and n.y < 0.2: return (RUF, WHITE)
        return SLATE
    def tcol(t, lv):
        if lv == 0 and 0.12 < t < 0.95 and bars(t, 0.16, 0.25, 0.05): return WHITE, WHITE
        return SLATE, 0x8a96a4
    def wcol(u, lv): return (SLATE if not (lv == 0 and bars(u, 0.25, 0.18, 0.1)) else 0x3e4f62), 0xd8dadc
    def hcol(v, lv): return (WHITE if lv == 0 and 0.125 < v < 0.25 else BLACK), 0xb8bcc0   # the white patch at the base of the primaries
    return dict(
        common='Belted kingfisher', name='kingfisher', job='01a1ad3b-e93c-70a8-bea3-372512334673',
        length=0.32, tail_m=0.07, mass=0.15, tris=[1000, 400, 120], variant='male in _COLORB (no rufous band)',
        cut=lambda p: p.z < -0.40 or p.y > 0.75,
        reshape=[],
        hip=V3(0, 0.35, -0.20), pitch=0.0, belly=V3(0, 0.36, -0.40),
        neck=V3(0, 0.15, 0.38), head_dir=V3(0, -0.3, 0.95), head_band=(-0.03, 0.07),
        rump=V3(0, 0.66, -0.15), tail_dir=V3(0, 0.6, -0.8), eye=EYE, protect=0.2,
        shoulder=V3(0, 0.22, 0.30), shoulder_x=0.024,
        legs=dict(knee_h=0.016, belly_h=0.011, legx=0.012, u=0.6, col=0x2a2626),
        eye_r=(0.0016, 0.0027, 0.0029),
        tail=dict(angle=-58.0, w0=0.013, w1=0.017, ridge=0.003, tip='square', n0=8, col=tcol),
        wing=dict(span=0.55, chord=0.95, hand='pointed', arm=wcol, hand_col=hcol, top=SLATE, under=0xd8dadc),
        color=col, grizzle=0.05)


RECIPES = {'troglodytes_pacificus': wren, 'perisoreus_canadensis': grayjay, 'poecile_rufescens': chickadee,
           'strix_varia': owl, 'megaceryle_alcyon': kingfisher}
if SPECIES not in RECIPES: raise SystemExit('--species one of ' + ', '.join(RECIPES))
R = RECIPES[SPECIES]()
JOB = R['job']; LENGTH, TAIL_M = R['length'], R['tail_m']
TIERS = list(zip(('lod0', 'lod1', 'lod2'), R['tris']))
VARIANT = 'variant' in R
L = R['legs']; U = L['u']


def reshape(p):
    for f, _ in R['reshape']: p = f(p)
    return p


def unreshape(p):
    for _, g in reversed(R['reshape']): p = g(p)
    return p


# ---- source: cut, fill, smooth the cut edges, reshape ----
ob = A.import_glb_mesh(SRC)
me = ob.data
bm = bmesh.new(); bm.from_mesh(me)
dele = [v for v in bm.verts if R['cut'](v.co)]
print('INFO cut verts', len(dele), 'of', len(bm.verts))
bmesh.ops.delete(bm, geom=dele, context='VERTS')
# keep the largest piece (a cut can leave crumbs: toe tips, a feather spike)
seen = set(); isl = []
for f in bm.faces:
    if f in seen: continue
    st = [f]; seen.add(f); grp = []
    while st:
        g = st.pop(); grp.append(g)
        for e in g.edges:
            for h in e.link_faces:
                if h not in seen: seen.add(h); st.append(h)
    isl.append(grp)
isl.sort(key=len, reverse=True)
bmesh.ops.delete(bm, geom=[f for grp in isl[1:] for f in grp], context='FACES')
bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
rim = set(v for e in bm.edges if e.is_boundary for v in e.verts)
rim |= set(u for v in list(rim) for e in v.link_edges for u in e.verts)
bmesh.ops.holes_fill(bm, edges=bm.edges, sides=0)
bmesh.ops.triangulate(bm, faces=bm.faces)
for _ in range(4): bmesh.ops.smooth_vert(bm, verts=list(rim), factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
for v in bm.verts: v.co = reshape(v.co)
bm.to_mesh(me); bm.free(); me.update()
V = me.vertices
print('INFO pieces after the cut', len(isl), 'kept', len(me.polygons), 'faces')

# ---- pitch about the hips (nose down) ----
HIP = reshape(R['hip'])
Rm = Matrix.Rotation(math.radians(R['pitch']), 3, 'X')
def P(p): return HIP + Rm @ (Vector(p) - HIP)
for v in V: v.co = P(v.co)
lm = lambda p: P(reshape(Vector(p)))                 # a raw landmark into the pitched frame

# ---- to metres ----
bill_tip = min((v.co for v in V), key=lambda c: c.y).copy()
NECK_P, RUMP_P, BELLY_P = lm(R['neck']), lm(R['rump']), lm(R['belly'])
path = (bill_tip - NECK_P).length + (NECK_P - RUMP_P).length
zmax = max(v.co.z for v in V)
if 'height' in R: S = (R['height'] - L['belly_h']) / (zmax - BELLY_P.z)
else: S = (LENGTH - TAIL_M) / path
GROUND = BELLY_P.z - L['belly_h'] / S
LEG_Y = BELLY_P.y
YOFF = -0.008 * U
def M(p): p = Vector(p); return Vector((p.x * S, (p.y - LEG_Y) * S + YOFF, (p.z - GROUND) * S))
INV = lambda q: Vector((q.x / S, (q.y - YOFF) / S + LEG_Y, q.z / S + GROUND))
RAW = lambda q: unreshape(HIP + Rm.transposed() @ (INV(q) - HIP))        # metres -> raw (source) coordinates
RAWN = lambda n: Rm.transposed() @ Vector((n.x, n.y, n.z))
for v in V: v.co = M(v.co)
me.update()
body_low = min(v.co.z for v in V)
print('INFO scale %.4f m/unit; body bottom %.4f m above ground; top %.3f m' % (S, body_low, max(v.co.z for v in V)))

# landmarks (metres, Blender axes)
NECK = M(NECK_P)
TAILP = M(RUMP_P)
SHOULDER = M(lm(R['shoulder'])); SHOULDER.x = R['shoulder_x']
KNEE = V3(L['legx'] - 0.002 * U, 0.004 * U, L['knee_h']); ANKLE = V3(L['legx'], -0.012 * U, 0.009 * U)
EYE = M(lm(R['eye']))
bvh = BVHTree.FromObject(ob, bpy.context.evaluated_depsgraph_get())
if R.get('eye_front'):
    hit = bvh.ray_cast(V3(EYE.x, EYE.y - 0.3, EYE.z), V3(0, 1, 0))[0]
    EYE_SURF = hit if hit else EYE
else:
    hit = bvh.ray_cast(V3(0.3, EYE.y, EYE.z), V3(-1, 0, 0))[0]
    EYE_SURF = V3(hit.x if hit else 0.01, EYE.y, EYE.z)
BILL_TIP = M(bill_tip)
print('INFO eye %s, neck %s, tail root %s, shoulder %s' % tuple(tuple(round(c, 4) for c in p) for p in (EYE_SURF, NECK, TAILP, SHOULDER)))

# ---- rig (mesh) ----
HD = R['head_dir'].normalized(); TD = R['tail_dir'].normalized()
def head_w(r): return smooth(R['head_band'][0], R['head_band'][1], (r - R['neck']).dot(HD))
def tail_w(r): return 0.6 * smooth(-0.06, 0.04, (r - R['rump']).dot(TD))
def vert_rig(i):
    r = RAW(V[i].co)
    hw = head_w(r)
    if hw > 0: return dict(part=HEAD, partw=hw, pivot=NECK)
    tw = tail_w(r)
    if tw > 0: return dict(part=TAIL, partw=tw, pivot=TAILP)
    return dict(part=BODY, partw=0.0, pivot=Vector())


# the head (and its field marks) decimated last
pg = ob.vertex_groups.new(name='protect'); PROTECT = R.get('protect', 0.4)
for v in V:
    w = head_w(RAW(v.co))
    if w > 0: pg.add([v.index], PROTECT * w, 'REPLACE')

# the tail's angle: the recipe's, raised where needed so its tip stays above the ground (the birds also hop)
TAIL_ANGLE = R['tail']['angle']
_Lt = 1.1 * TAIL_M; _floor = 0.15 * L['belly_h']
if TAILP.z + math.sin(math.radians(TAIL_ANGLE)) * _Lt < _floor:
    TAIL_ANGLE = math.degrees(math.asin(max(-1.0, (_floor - TAILP.z) / _Lt)))
    print('INFO tail angle raised from %.0f to %.1f degrees to keep its tip above the ground' % (R['tail']['angle'], TAIL_ANGLE))


def pair(h): return h if isinstance(h, tuple) else (h, h)


def body_color(c, n, level, corners=()):
    """(COLOR_0, _COLORB) linear for a body face: the region colour sampled at the centre (twice) and toward each corner,
    averaged, so a large face straddling a bar or a boundary takes the blend rather than one side's colour."""
    rn = RAWN(n); r0 = RAW(c)
    pts = [r0, r0] + [RAW(c + (q - c) * 0.6) for q in corners]
    sa = [0.0] * 3; sb = [0.0] * 3
    for r in pts:
        a, b = pair(R['color'](r, rn, level, head_w(r)))
        la, lb = A.srgb2lin(a), A.srgb2lin(b)
        for i in range(3): sa[i] += la[i] / len(pts); sb[i] += lb[i] / len(pts)
    k = 1 + R['grizzle'] * (2 * A.hash01(abs(r0.x) // 0.04, r0.y // 0.04, r0.z // 0.04) - 1)
    return tuple(min(1.0, x * k) for x in sa), tuple(min(1.0, x * k) for x in sb)


class Extra:
    def __init__(self): self.tris = []
    def quad(self, p, col, rig, out, tri=False):
        for i, j, k in (((0, 1, 2),) if tri else ((0, 1, 2), (0, 2, 3))):
            a, b, c = Vector(p[i]), Vector(p[j]), Vector(p[k])
            if (b - a).cross(c - a).dot(out) < 0: b, c = c, b
            self.tris.append((a, b, c, col, rig))
    def slab(self, poly, ct, cb, rig, thick, up=Vector((0, 0, 1))):
        off = up * thick
        for i in range(1, len(poly) - 1):
            self.quad([poly[0] + off, poly[i] + off, poly[i + 1] + off], ct, rig, up, tri=True)
            self.quad([poly[0], poly[i], poly[i + 1]], cb, rig, -up, tri=True)
    def tube(self, pts, radii, col, rig, sides=3):
        rings = []
        for i, p in enumerate(pts):
            t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
            a = Vector((1, 0, 0)) if abs(t.x) < 0.9 else Vector((0, 1, 0))
            u = t.cross(a).normalized(); w = t.cross(u)
            rings.append([p + (u * math.cos(2 * math.pi * k / sides) + w * math.sin(2 * math.pi * k / sides)) * radii[i] for k in range(sides)])
        for i in range(len(pts) - 1):
            m = (pts[i] + pts[i + 1]) / 2
            for k in range(sides):
                a, b = rings[i][k], rings[i][(k + 1) % sides]; c2, d = rings[i + 1][k], rings[i + 1][(k + 1) % sides]
                if radii[i + 1] == 0: self.quad([a, b, pts[i + 1]], col, rig, (a + b) / 2 - m, tri=True)
                else:
                    self.quad([a, b, d], col, rig, (a + b + d) / 3 - m, tri=True); self.quad([a, d, c2], col, rig, (a + d + c2) / 3 - m, tri=True)
    def ellipsoid(self, c, r, col, rig):
        Q = [c + Vector((r.x, 0, 0)), c - Vector((r.x, 0, 0)), c + Vector((0, r.y, 0)), c - Vector((0, r.y, 0)), c + Vector((0, 0, r.z)), c - Vector((0, 0, r.z))]
        for a, b in ((0, 2), (2, 1), (1, 3), (3, 0)):
            for apex in (4, 5): self.quad([Q[a], Q[b], Q[apex]], col, rig, (Q[a] + Q[b] + Q[apex]) / 3 - c, tri=True)


def legs(ex, level):
    col, toe, talon = L['col'], L.get('toe', L['col']), L.get('talon', L['col'])
    fe = 2.6 if L.get('feathered') else 1.0
    for s in (1, -1):
        rig = (LEG_A if s > 0 else LEG_B, 1.0, Vector((s * KNEE.x, KNEE.y, KNEE.z)))
        K = Vector((s * KNEE.x, KNEE.y, KNEE.z)); Ak = Vector((s * ANKLE.x, ANKLE.y, ANKLE.z))
        if level == 2: ex.tube([K, Ak + Vector((0, -0.004, -0.007)) * U], [0.0017 * U * fe, 0], col, rig); continue
        ex.tube([K, Ak], [0.0019 * U * fe, 0.0014 * U * fe], col, rig, sides=4 if fe > 1 else 3)
        for ang, ln in ((-0.42, 0.023), (0.0, 0.026), (0.42, 0.023), (math.pi, 0.015)):
            d = Vector((s * math.sin(ang) * 0.8, -math.cos(ang), 0)); ln *= U
            if level == 0:
                p1 = Ak + d * (ln * 0.55) + Vector((0, 0, -0.005 * U)); p2 = Ak + d * ln + Vector((0, 0, -0.0085 * U))
                if L.get('feathered'):
                    ex.tube([Ak, p1, p2], [0.0016 * U, 0.0013 * U, 0.0009 * U], toe, rig)
                    ex.tube([p2, p2 + d * 0.006 * U + Vector((0, 0, -0.0008 * U))], [0.0008 * U, 0], talon, rig)   # the talon
                else: ex.tube([Ak, p1, p2], [0.0012 * U, 0.001 * U, 0], toe, rig)
            else: ex.tube([Ak, Ak + d * ln + Vector((0, 0, -0.0075 * U))], [0.0011 * U * (1.4 if fe > 1 else 1), 0], talon if fe > 1 else toe, rig)


def tail(ex, level):
    """A tail lofted from the rump at the species' angle: a flat underside and a top raised along the middle (the
    folded central feathers); the tip rounded (a short point) or square."""
    T = R['tail']; rig = (TAIL, 1.0, TAILP)
    a = math.radians(TAIL_ANGLE); d = Vector((0, math.cos(a), math.sin(a))); up = Vector((0, -math.sin(a), math.cos(a)))
    ov = 0.1 * TAIL_M; Lt = TAIL_M + ov; root = TAILP - d * ov
    rnd = T['tip'] == 'round'
    halfw = lambda t: (T['w0'] + (T['w1'] - T['w0']) * smooth(0, 0.4, t)) * (1 - (0.35 if rnd else 0.0) * smooth(0.85, 1, t) ** 2)
    ridge = lambda t: T['ridge'] * (1 - 0.6 * t)
    n = {0: T['n0'], 1: 4, 2: 2}[level]
    ts = sorted(set([i / n for i in range(n + 1)] + ([i / 40 for i in range(41)] if level == 0 and T['n0'] >= 6 else [])))
    if level == 0:   # merge stations where the colour does not change (keeps the triangle count down)
        keep = [ts[0]]
        for i in range(1, len(ts) - 1):
            if T['col']((ts[i - 1] + ts[i]) / 2, 0) != T['col']((ts[i] + ts[i + 1]) / 2, 0) or ts[i] in [k / n for k in range(n + 1)]: keep.append(ts[i])
        ts = keep + [1.0]
    if rnd: ts += [1.06]
    for i in range(len(ts) - 1):
        t0, t1 = ts[i], ts[i + 1]; tip = rnd and i == len(ts) - 2
        top, under = T['col']((t0 + min(t1, 1)) / 2, level)
        c0, c1 = root + d * Lt * t0, root + d * Lt * min(t1, 1) + (d * 0.05 * Lt if tip else Vector())
        w0, w1 = halfw(t0), (0.0 if tip else halfw(t1))
        X = Vector((1, 0, 0))
        l0, r0, m0 = c0 + X * w0, c0 - X * w0, c0 + up * ridge(t0)
        l1, r1, m1 = c1 + X * w1, c1 - X * w1, c1 + up * ridge(min(t1, 1))
        if tip:
            ex.quad([l0, m0, m1], top, rig, up, tri=True); ex.quad([m0, r0, m1], top, rig, up, tri=True)
            ex.quad([l0, r0, m1], under, rig, -up, tri=True)
        else:
            ex.quad([l0, l1, m1, m0], top, rig, up + X * 0.3); ex.quad([m0, m1, r1, r0], top, rig, up - X * 0.3)
            ex.quad([l0, l1, r1, r0], under, rig, -up)
            if not rnd and i == len(ts) - 2:   # the square end: close the ridge
                ex.quad([l1, m1, r1], top, rig, d, tri=True)


# the hand outlines (Steller's jay units: the wrist at x 0.078, the tip at 0.19; y back from the leading edge)
HANDS = {
    'round': [(0.078, -0.015), (0.135, -0.012), (0.172, 0.0), (0.19, 0.024), (0.18, 0.048), (0.15, 0.062), (0.078, 0.066)],
    'broad': [(0.078, -0.017), (0.13, -0.015), (0.168, -0.004), (0.188, 0.018), (0.19, 0.045), (0.17, 0.068), (0.13, 0.078), (0.078, 0.072)],
    'pointed': [(0.078, -0.014), (0.15, -0.006), (0.19, 0.014), (0.175, 0.034), (0.135, 0.054), (0.078, 0.064)],
}


def clip_x(poly, x0, x1):
    """A convex polygon [(x, y)] clipped to x0 <= x <= x1 (Sutherland-Hodgman, two edges)."""
    def cut(pts, inside, xc):
        out = []
        for i in range(len(pts)):
            a, b = pts[i], pts[(i + 1) % len(pts)]
            ia, ib = inside(a), inside(b)
            if ia: out.append(a)
            if ia != ib:
                t = (xc - a[0]) / (b[0] - a[0]); out.append((xc, a[1] + (b[1] - a[1]) * t))
        return out
    p = cut(poly, lambda q: q[0] >= x0, x0)
    return cut(p, lambda q: q[0] <= x1, x1) if p else p


def wings(ex, level):
    Wg = R['wing']; W = SHOULDER
    sx = (Wg['span'] / 2 - W.x) / 0.19; sy = sx * Wg['chord']
    thick = 0.0012 * max(0.6, sx)
    hand = HANDS[Wg['hand']]
    for s in (1, -1):
        piv = Vector((s * W.x, W.y, W.z)); wrist = Vector((s * (W.x + 0.078 * sx), W.y, W.z))
        Pw = lambda dx, dy: Vector((s * (W.x + dx * sx), W.y + dy * sy, W.z))
        arm_rig = (WING_L if s > 0 else WING_R, 1.0, piv); hand_rig = (HAND_L if s > 0 else HAND_R, 1.0, wrist)
        if level == 2:
            ex.slab([Pw(0, -0.018), Pw(0.17, -0.006), Pw(0.19, 0.033), Pw(0, 0.068)], Wg['top'], Wg['under'], arm_rig, thick); continue
        if level == 0:   # the arm in chordwise rows (bars across the secondaries)
            us = [i / 8 for i in range(9)]
            rows = []
            for i in range(8):
                c = Wg['arm']((us[i] + us[i + 1]) / 2, 0)
                if rows and rows[-1][2] == c: rows[-1][1] = us[i + 1]
                else: rows.append([us[i], us[i + 1], c])
            for u0, u1, (ct, cb) in rows:
                f0, f1 = -0.018 + 0.086 * u0, -0.018 + 0.086 * u1; g0, g1 = -0.014 + 0.078 * u0, -0.014 + 0.078 * u1
                ex.slab([Pw(0, f0), Pw(0.078, g0), Pw(0.078, g1), Pw(0, f1)], ct, cb, arm_rig, thick)
            vs = [i / 8 for i in range(9)]   # the hand in spanwise bands (bars across the primaries)
            bands = []
            for i in range(8):
                c = Wg['hand_col']((vs[i] + vs[i + 1]) / 2, 0)
                if bands and bands[-1][2] == c: bands[-1][1] = vs[i + 1]
                else: bands.append([vs[i], vs[i + 1], c])
            for v0, v1, (ct, cb) in bands:
                pts = clip_x(hand, 0.078 + 0.112 * v0, 0.078 + 0.112 * v1)
                if len(pts) >= 3: ex.slab([Pw(*q) for q in pts], ct, cb, hand_rig, thick)
        else:
            ex.slab([Pw(0, -0.018), Pw(0.078, -0.014), Pw(0.078, 0.064), Pw(0, 0.068)], Wg['top'], Wg['under'], arm_rig, thick)
            ex.slab([Pw(*q) for q in hand], Wg['top'], Wg['under'], hand_rig, thick)


def eyes(ex):
    er = Vector(R['eye_r']); col = R.get('eye_col', 0x0a0a0c)
    for s in (1, -1):
        if R.get('eye_front'):   # an owl's forward eye: a shallow eight-sided cone standing just proud of the face disc
            c = Vector((s * abs(EYE_SURF.x), EYE_SURF.y - er.y, EYE_SURF.z))
            nrm = Vector((s * 0.25, -1, 0)).normalized(); u = Vector((0, 0, 1)); w = nrm.cross(u).normalized()
            ring = [c + (w * math.cos(2 * math.pi * k / 8) + u * math.sin(2 * math.pi * k / 8)) * er.x for k in range(8)]
            apex = c + nrm * er.y
            for k in range(8): ex.quad([ring[k], ring[(k + 1) % 8], apex], col, (HEAD, 1.0, NECK), nrm, tri=True)
            continue
        c = Vector((s * (EYE_SURF.x - 0.4 * er.x), EYE_SURF.y, EYE_SURF.z))
        ex.ellipsoid(c, er, col, (HEAD, 1.0, NECK))


def bill(ex, level):
    B = R.get('bill')
    if not B: return
    base = M(lm(B['at'])); hit = bvh.ray_cast(V3(0, base.y - 0.3, base.z), V3(0, 1, 0))[0]
    if hit: base = hit + Vector((0, 0.3 * B['radius'], 0))
    d = Vector(B['dir']).normalized()
    ex.tube([base, base + d * B['length']], [B['radius'], 0], B['col'], (HEAD, 1.0, NECK), sides=4 if level < 2 else 3)


# ---- tiers ----
def build(level, target):
    global V
    ex = Extra(); legs(ex, level); tail(ex, level); wings(ex, level); bill(ex, level)
    if level == 0 or R.get('eye_front'): eyes(ex)
    o, n0 = A.tier_copy(ob, target - len(ex.tris), protect='protect' if level < 2 else None, protect_factor=(1.0, 0.6, 0)[level])
    V0 = V; V = o.data.vertices
    m = o.data
    key2i = {}; out = dict(pos=[], col=[], colb=[], part=[], partw=[], piv=[], idx=[]); rig = {}
    for p in m.polygons:
        fa, fb = body_color(p.center, p.normal, level, [m.vertices[vi].co for vi in p.vertices])
        for vi in p.vertices:
            k = (vi, fa, fb)
            if k not in key2i:
                key2i[k] = len(out['pos'])
                if vi not in rig: rig[vi] = vert_rig(vi)
                rr = rig[vi]
                out['pos'].append(A.to3(m.vertices[vi].co)); out['col'].append(fa); out['colb'].append(fb)
                out['part'].append(float(rr['part'])); out['partw'].append(float(rr['partw'])); out['piv'].append(A.to3(rr['pivot']))
            out['idx'].append(key2i[k])
    V = V0
    nbody = len(out['idx']) // 3
    for a, b, c, h, (pt, w, pv) in ex.tris:
        ha, hb = pair(h); fa, fb = A.srgb2lin(ha), A.srgb2lin(hb)
        for p in (a, b, c):
            out['idx'].append(len(out['pos'])); out['pos'].append(A.to3(p)); out['col'].append(fa); out['colb'].append(fb)
            out['part'].append(float(pt)); out['partw'].append(float(w)); out['piv'].append(A.to3(pv))
    bpy.data.objects.remove(o)
    print('TIER', level, 'tris', len(out['idx']) // 3, f'(body {nbody}, legs/tail/wings/eyes/bill {len(ex.tris)})', 'verts', len(out['pos']), 'from', n0)
    return out


def write_glb(path, tiers, generator, copyright, extras):
    """animal_glb.write_glb plus an optional _COLORB (vec3, linear): the second colour set."""
    buf = bytearray(); views = []; accs = []
    def add(data, target):
        while len(buf) % 4: buf.append(0)
        off = len(buf); buf.extend(data)
        views.append({'buffer': 0, 'byteOffset': off, 'byteLength': len(data), 'target': target}); return len(views) - 1
    def acc_f(vals, n):
        flat = [x for v in vals for x in (tuple(v) if n > 1 else (v,))]
        a = {'bufferView': add(struct.pack(f'<{len(flat)}f', *flat), 34962), 'componentType': 5126, 'count': len(vals), 'type': {1: 'SCALAR', 3: 'VEC3'}[n]}
        if n == 3: a['min'] = [min(v[k] for v in vals) for k in range(3)]; a['max'] = [max(v[k] for v in vals) for k in range(3)]
        accs.append(a); return len(accs) - 1
    def acc_i(vals):
        big = max(vals) > 65535
        accs.append({'bufferView': add(struct.pack(f'<{len(vals)}{"I" if big else "H"}', *vals), 34963), 'componentType': 5125 if big else 5123, 'count': len(vals), 'type': 'SCALAR'})
        return len(accs) - 1
    meshes = []; nodes = []
    for name, t in tiers:
        attrs = {'POSITION': acc_f(t['pos'], 3), 'COLOR_0': acc_f(t['col'], 3), '_PART': acc_f(t['part'], 1),
                 '_PARTW': acc_f(t['partw'], 1), '_PIVOT': acc_f(t['piv'], 3)}
        if VARIANT: attrs['_COLORB'] = acc_f(t['colb'], 3)
        meshes.append({'name': name, 'primitives': [{'attributes': attrs, 'indices': acc_i(t['idx']), 'mode': 4}]})
        nodes.append({'name': name, 'mesh': len(meshes) - 1})
    while len(buf) % 4: buf.append(0)
    g = {'asset': {'version': '2.0', 'generator': generator, 'copyright': copyright},
         'scene': 0, 'scenes': [{'nodes': list(range(len(nodes)))}], 'nodes': nodes, 'meshes': meshes,
         'accessors': accs, 'bufferViews': views, 'buffers': [{'byteLength': len(buf)}], 'extras': extras}
    js = json.dumps(g, separators=(',', ':')).encode()
    while len(js) % 4: js += b' '
    glb = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(buf)) + struct.pack('<I4s', len(js), b'JSON') + js + struct.pack('<I4s', len(buf), b'BIN\x00') + bytes(buf)
    open(path, 'wb').write(glb)
    print('WROTE', path, len(glb), 'bytes;', ', '.join(f'{n} {len(t["idx"]) // 3} tris' for n, t in tiers))


tiers = [(name, build(i, t)) for i, (name, t) in enumerate(TIERS)]
a = math.radians(TAIL_ANGLE)
TAIL_TIP = TAILP + Vector((0, math.cos(a), math.sin(a))) * TAIL_M
span = 2 * (SHOULDER.x + 0.19 * (R['wing']['span'] / 2 - SHOULDER.x) / 0.19)
top = max(p.y for p in tiers[0][1]['pos'])
print('LANDMARKS %s: bill to tail %.3f m (bill tip to the neck to the rump %.3f + tail %.3f); straight bill tip to tail tip %.3f m; '
      'height %.3f m; card span %.3f m; bill tip %s, eye %s, neck %s, tail root %s, tail tip %s, shoulder %s, knee %s; mass %.3f kg'
      % (R['common'], path * S + TAIL_M, path * S, TAIL_M, (TAIL_TIP - BILL_TIP).length, top, span,
         *[tuple(round(c, 3) for c in p) for p in (BILL_TIP, EYE_SURF, NECK, TAILP, TAIL_TIP, SHOULDER, KNEE)], R['mass']))
RIG = {'kind': 'bird', 'wing': list(A.to3(SHOULDER)), 'tail': list(A.to3(TAILP)), 'head': list(A.to3(NECK)), 'length_m': LENGTH}
if VARIANT: RIG['variant'] = R['variant']
write_glb(OUT, tiers, 'wild-earth tools/build_songbird.py (Blender)',
          f"{R['common']}: generated with Meshy (meshy.ai), task {JOB}, owned by the account holder (Aaron Brodeur), CC BY-SA 4.0; rebuilt (tail and legs replaced, reshaped, recoloured, decimated, wing cards added) by wild-earth tools/build_songbird.py --species {SPECIES}",
          extras={'species': SPECIES, 'rig': RIG,
                  'source': {'kind': 'meshy', 'job_id': JOB, 'ai_model': 'meshy-6-lite', 'mode': 'text-to-3d preview',
                             'generator': 'Khronos glTF Blender I/O (Meshy export)', 'ai_generated': True,
                             'meshy_metadata': 'none embedded in the source GLB'}})

# ---- optional preview: lod0 with its vertex colours (workbench, orthographic), one PNG of six views ----
if PREVIEW:
    sc = bpy.context.scene
    ob.hide_render = True
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.display.shading.light = 'FLAT'; sc.display.shading.color_type = 'VERTEX'
    Wd, Ht = 600, 450
    sc.render.resolution_x = Wd; sc.render.resolution_y = Ht
    sc.world = bpy.data.worlds.new('w'); sc.world.color = (0.55, 0.6, 0.62)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = 'ORTHO'
    files = []
    for pi, key in ((0, 'col'), (0, 'colb')) if VARIANT else ((0, 'col'),):
        name, t = tiers[pi]
        pm = bpy.data.meshes.new('preview')
        pm.from_pydata([(p.x, -p.z, p.y) for p in t['pos']], [], [tuple(t['idx'][i:i + 3]) for i in range(0, len(t['idx']), 3)])
        ca = pm.color_attributes.new('col', 'FLOAT_COLOR', 'POINT')
        for i, c in enumerate(t[key]): ca.data[i].color = (*c, 1.0)
        pm.color_attributes.active_color = ca
        po = bpy.data.objects.new('preview', pm); sc.collection.objects.link(po)
        hz = max(p.y for p in t['pos']); size = max(LENGTH, hz * 1.4) * 1.2
        cz = hz / 2
        hp = [Vector((p.x, -p.z, p.y)) for p, pt in zip(t['pos'], t['part']) if pt == HEAD]
        hc = sum(hp, Vector()) / len(hp)
        views = [('side', (0, 0.0, cz), (1, 0, 0.02), (0, 0, 1), size), ('front', (0, 0, cz), (0, -1, 0.1), (0, 0, 1), size),
                 ('top', (0, 0.0, cz), (0, 0, 1), (0, -1, 0), size), ('q', (0, 0, cz), (0.8, -0.7, 0.45), (0, 0, 1), size),
                 ('head', tuple(hc), (1, -0.6, 0.15), (0, 0, 1), size * 0.4), ('headf', tuple(hc), (0.25, -1, 0.1), (0, 0, 1), size * 0.4)]
        if key == 'colb': views = views[:1] + views[3:4]
        for view, ctr, dv, upv, scale in views:
            ctr = Vector(ctr); cam.data.ortho_scale = scale
            fwd = -Vector(dv).normalized(); u = Vector(upv)
            r = fwd.cross(u).normalized(); u = r.cross(fwd)
            mw = Matrix((r, u, -fwd)).transposed().to_4x4(); mw.translation = ctr - fwd * 3
            cam.matrix_world = mw
            f = f'{PREVIEW}_{key}_{view}.png'; sc.render.filepath = f
            bpy.ops.render.render(write_still=True); files.append(f)
        bpy.data.objects.remove(po)
    # stitch: two columns
    cols = 2; rows = (len(files) + 1) // 2
    big = [0.0] * (Wd * cols * Ht * rows * 4)
    for k, f in enumerate(files):
        im = bpy.data.images.load(f); px = list(im.pixels)
        ox, oy = (k % cols) * Wd, (rows - 1 - k // cols) * Ht
        for y in range(Ht):
            o = ((oy + y) * Wd * cols + ox) * 4
            big[o:o + Wd * 4] = px[y * Wd * 4:(y + 1) * Wd * 4]
        os.remove(f)
    out = bpy.data.images.new('m', Wd * cols, Ht * rows); out.pixels = big
    out.filepath_raw = f'{PREVIEW}.png'; out.file_format = 'PNG'; out.save()
    print('PREVIEW', f'{PREVIEW}.png')
