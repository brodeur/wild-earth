# Build the Hoh rain forest's perching birds on the Steller's jay's bird template (tools/build_stellersjay.py), one
# species per run, from Meshy text-to-3D previews: the Pacific wren, the Canada (gray) jay, the chestnut-backed
# chickadee, the barred owl and the belted kingfisher; then (second batch) the American robin and the European
# starling from their own previews, and six free variants of those sources: the varied thrush (the robin's), the
# dark-eyed junco, golden-crowned kinglet and Pacific-slope flycatcher (the chickadee's), and the western screech-owl
# and northern saw-whet owl (the barred owl's).
#
# Sources: Meshy (meshy.ai) text-to-3D previews, ai_model meshy-6-lite, untextured triangle meshes (about 20,300-20,850
#   triangles each, one piece), 2026-11-05 UTC (the robin and starling 2026-11-06 01:47-01:49 UTC), 5 credits each; job
#   records in library/animals/jobs/<species>/<task>/job.json. Tasks and prompts:
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
#   turdus_migratorius 01a1ae89-b054-70ad-a469-fe5fce865630: "An American robin (Turdus migratorius), one adult male
#     standing on the ground, side-on pose, upright alert thrush posture, wings folded tight against the body. Realistic
#     proportions: 25 cm long, a round chest, a medium-long tail, a straight yellow bill, long thin legs. Dark grey-brown
#     back, wings and tail, a blackish head with a broken white eye ring, a white-streaked throat, a brick-red orange
#     breast and belly, white under the tail. Three toes forward and one back. No base, no perch. Game-ready, clean
#     closed mesh."
#   sturnus_vulgaris 01a1ae8b-3af1-7031-aa17-96a16473bf59: "A European starling (Sturnus vulgaris), one adult standing on
#     the ground, side-on pose, wings folded tight. Realistic proportions: 21 cm long, a stocky body, a short square
#     tail, a long pointed straight yellow bill, a flat head, pinkish legs. Glossy black plumage with a green and purple
#     sheen, the body speckled with small white and buff spots, buff edges on the wing feathers. Three toes forward and
#     one back. No base, no perch. Game-ready, clean closed mesh."
#   Free variants (no credits; the same Meshy output, reshaped and recoloured, so the same ownership and licence):
#   ixoreus_naevius from turdus_migratorius's task; junco_hyemalis, regulus_satrapa and empidonax_difficilis from
#   poecile_rufescens's 01a1ad39-ae77-7764-bea5-e718f3527f65; megascops_kennicottii and aegolius_acadicus from
#   strix_varia's 01a1ad38-4e76-7191-8ddc-c7409132af60. Their GLBs record extras.source.kind 'variant', variant_of,
#   credits 0.
# Licence: generated through the Meshy API on the account holder's paid plan, so the output is owned by the account
#   holder (Meshy Terms of Use 3.2, https://www.meshy.ai/terms-of-use, last updated 2026-09-19) and released with the
#   project's assets under CC BY-SA 4.0. Credit: "generated with Meshy (meshy.ai)". Terms 2.4: AI-identifying metadata
#   Meshy embeds is carried over; these files carried none (asset.generator only, which is kept in extras.source).
#
# Rebuild (Blender 4.1; run from the repo root), one species per run:
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/build_songbird.py -- \
#       library/animals/jobs/<species>/<task>/model.glb client/assets/<name>.glb --species <species> [--preview /tmp/p]
#   troglodytes_pacificus -> pacific_wren.glb, perisoreus_canadensis -> gray_jay.glb, poecile_rufescens ->
#   chickadee.glb, strix_varia -> barred_owl.glb, megaceryle_alcyon -> kingfisher.glb (the task folders are above);
#   turdus_migratorius -> american_robin.glb, sturnus_vulgaris -> starling.glb, and with the source species' model.glb:
#   ixoreus_naevius -> varied_thrush.glb (the robin's), junco_hyemalis -> junco.glb, regulus_satrapa -> kinglet.glb,
#   empidonax_difficilis -> flycatcher.glb (the chickadee's), megascops_kennicottii -> screech_owl.glb,
#   aegolius_acadicus -> saw_whet_owl.glb (the barred owl's).
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
# there). The second batch adds: the robin's _COLORB (COLOR_0 the male, _COLORB the paler female: a greyer head and
# back, a paler orange breast), a pale eye ring behind the eye (the robin's broken ring; the flycatcher's teardrop, set
# back), whole-face spots decided at the face centre and weakened on faces bigger than a spot (the starling's white and
# buff speckle, the screech-owl's scapular row, the saw-whet's white spots), white outer tail feathers (the junco's), a
# notched tail tip (the kinglet's), ear tufts (the screech-owl's, set into the crown), owl eyes as a yellow iris with a
# black pupil, and reshapes (the flycatcher's crown peaked at the back and its bill broadened; the small owls' heads
# widened 1.05 and 1.22). The flycatcher is pitched 30 degrees nose-up to its upright perch (about 45 degrees); the
# robin, varied thrush and starling stand as ground foragers, near level. Tiers lod0 ~1,000, lod1 ~400, lod2 ~120
# triangles (the barred owl ~1,400 / 500 / 150, the small owls ~1,200 / 450 / 140), body decimated (the head kept back)
# with Blender collapse, X symmetry. Rig: the Steller's jay's bird template (animalModels.js PART): BODY 0, LEG_A 1 / LEG_B 2
# (pivot at the knee), TAIL 3 (pivot at the rump), HEAD 6 (head and neck, pivot at the base of the neck), WING_L/R 4/5
# and HAND_L/R 9/10 cards; extras.rig {kind 'bird', wing, tail, head, length_m} as the Steller's jay's. Origin on the
# ground between the feet.
# Output: one GLB with meshes lod0, lod1, lod2 (POSITION, COLOR_0 linear, _PART, _PARTW, _PIVOT, indices; the
# kingfisher and the robin also _COLORB).
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


# ---- the second batch: robin and starling from their own previews; the rest free variants of earlier sources ----
ROBIN_JOB, CHICK_JOB, OWL_JOB = '01a1ae89-b054-70ad-a469-fe5fce865630', '01a1ad39-ae77-7764-bea5-e718f3527f65', '01a1ad38-4e76-7191-8ddc-c7409132af60'
THRUSH_EYE = V3(0, -0.725, 0.603)          # the robin source's eye (no eye is modelled; placed behind the bill base)


def thrush_lower(y): return 0.065 - 0.29 * (y + 0.36)      # the robin source's folded wing, lower edge


def thrush_geom(**kw):
    """The robin source's landmarks (raw), shared by the robin and the varied thrush."""
    g = dict(cut=lambda p: p.y > 0.33 or p.z < -0.225, reshape=[],
             hip=V3(0, -0.05, -0.08), pitch=6.0, belly=V3(0, -0.02, -0.215),
             neck=V3(0, -0.58, 0.42), head_dir=V3(0, -0.6, 0.8), head_band=(-0.03, 0.07),
             rump=V3(0, 0.29, -0.08), tail_dir=V3(0, 1, -0.25), eye=THRUSH_EYE,
             shoulder=V3(0, -0.40, 0.27))
    g.update(kw); return g


def robin():
    # (male, female): COLOR_0 the male, _COLORB the paler female (greyer head, paler orange breast)
    HEADC, BACK, WING, EDGE = (0x24201e, 0x5c5650), (0x4a4440, 0x6a645d), (0x45403b, 0x655f58), (0x6c645c, 0x857d74)
    BREAST, WHITE, STREAK = (0xa9461b, 0xc27f4c), 0xeeebe4, (0x24201e, 0x5c5650)
    BILL, BILLT, TAILC, TAILU = 0xdcaa26, 0x5a4826, (0x2c2826, 0x4c4741), (0x3e3a37, 0x58534d)
    E = THRUSH_EYE
    def col(r, n, lv, hw):
        if r.y < -0.80 and 0.53 < r.z < 0.63: return BILLT if r.y < -0.91 else BILL
        if hw > 0.5:
            if r.z < E.z - 0.075 and r.y < -0.62 and n.y < -0.15 and not side(n, 0.8):   # the throat, white streaked
                return STREAK if lv == 0 and bars(r.x, 0.06, 0.45, 0.015) else WHITE
            return HEADC
        if r.y > -0.06 and n.z < -0.35: return WHITE                                       # lower belly, vent, undertail
        if side(n) and -0.42 < r.y < 0.34 and r.z > thrush_lower(r.y) and n.z < 0.6:      # the folded wing, pale edges
            return EDGE if lv == 0 and bars(r.y + 0.5 * r.z, 0.1, 0.22) else WING
        if n.z > 0.25: return BACK
        if r.y < -0.42 and r.z > 0.28 and n.y > -0.35: return BACK                        # hind neck
        return BREAST
    def tcol(t, lv): return TAILC, TAILU
    def wcol(u, lv): return (EDGE if lv == 0 and bars(u, 0.25, 0.2, 0.15) else WING), (0xa0704c, 0xb48a66)   # rufous underwing
    def hcol(v, lv): return WING, (0x7c7470, 0x8c847e)
    return dict(
        common='American robin', name='american_robin', job=ROBIN_JOB, variant='female in _COLORB',
        length=0.25, tail_m=0.10, mass=0.077, tris=[1000, 400, 120],
        **thrush_geom(), shoulder_x=0.022,
        legs=dict(knee_h=0.046, belly_h=0.035, legx=0.014, u=0.85, col=0x4e4038),
        eye_r=(0.0018, 0.0029, 0.0031), eye_ring=(0xf0ede6, (0.8, 1.55, 1.6), 0.0),
        tail=dict(angle=-16.0, w0=0.011, w1=0.021, ridge=0.006, tip='square', n0=4, col=tcol),
        wing=dict(span=0.37, chord=1.05, hand='round', arm=wcol, hand_col=hcol, top=WING, under=(0xa0704c, 0xb48a66)),
        color=col, grizzle=0.06)


def starling():
    PURP, GREEN, WINGC, EDGE = 0x251e2b, 0x1b251f, 0x211d20, 0x6e5636
    BUFF, WHITE, BILL, LEG = 0xd2bc8e, 0xe8e2d4, 0xdcb82c, 0xc48a7c
    EYE = V3(0, -0.593, 0.60)
    def lower(y): return 0.065 - 0.12 * (y + 0.45)
    def wing(r, n): return side(n) and -0.50 < r.y < 0.45 and r.z > lower(r.y) and n.z < 0.6
    def col(r, n, lv, hw):
        if r.y < -0.76 and 0.50 < r.z < 0.63: return BILL
        if hw > 0.5: return PURP
        if wing(r, n): return EDGE if lv == 0 and bars(r.y + 0.6 * r.z, 0.1, 0.14) else WINGC   # folded wing, buff fringes
        return mix(PURP, GREEN, smooth(-0.5, -0.1, r.y))                                    # purple neck, green body
    def spots(r, n, lv, hw):   # small white and buff spots, one face each (fewer on the head, none on the bill or wing)
        if lv == 2 or (r.y < -0.74 and 0.48 < r.z < 0.65) or wing(r, n): return None
        h = A.hash01(abs(r.x) // 0.012, r.y // 0.012, r.z // 0.012)
        if hw > 0.5: return BUFF if lv == 0 and n.z > 0.2 and h < 0.08 else None
        if n.z > 0.25: return BUFF if h < 0.2 else None
        return WHITE if h < 0.3 else None
    def tcol(t, lv): return (EDGE if lv == 0 and t > 0.9 else WINGC), 0x302a2a
    def wcol(u, lv): return (EDGE if lv == 0 and u > 0.875 else WINGC), 0x4a4440
    def hcol(v, lv): return (EDGE if lv == 0 and v > 0.88 else WINGC), 0x4a4440
    return dict(
        common='European starling', name='starling', job='01a1ae8b-3af1-7031-aa17-96a16473bf59',
        length=0.21, tail_m=0.06, mass=0.078, tris=[1000, 400, 120],
        cut=lambda p: p.y > 0.42 or p.z < -0.27,
        reshape=[],
        hip=V3(0, 0.0, -0.10), pitch=4.0, belly=V3(0, 0.02, -0.27),
        neck=V3(0, -0.48, 0.40), head_dir=V3(0, -0.6, 0.8), head_band=(-0.03, 0.07),
        rump=V3(0, 0.34, -0.11), tail_dir=V3(0, 1, -0.15), eye=EYE, protect=0.3,
        shoulder=V3(0, -0.40, 0.25), shoulder_x=0.02,
        legs=dict(knee_h=0.036, belly_h=0.027, legx=0.013, u=0.75, col=LEG),
        eye_r=(0.0016, 0.0025, 0.0027),
        tail=dict(angle=-10.0, w0=0.011, w1=0.016, ridge=0.0045, tip='square', n0=4, col=tcol),
        wing=dict(span=0.38, chord=0.95, hand='pointed', arm=wcol, hand_col=hcol, top=WINGC, under=0x4a4440),
        color=col, spots=spots, spot_max=0.0045, grizzle=0.10)


def varied_thrush():
    SLATE, ORANGE, BLACK, BELLY, SCAL = 0x4b5866, 0xd2742a, 0x1e2124, 0xd9d8d2, 0x8e959c
    WING, BILL, WHITE = 0x414c58, 0x2a2624, 0xeeece6
    E = THRUSH_EYE
    def col(r, n, lv, hw):
        if r.y < -0.80 and 0.53 < r.z < 0.63: return BILL
        if hw > 0.5:
            if side(n, 0.45) and r.y > E.y - 0.05:
                if E.z + 0.025 < r.z < E.z + 0.075: return ORANGE                                  # the eyebrow stripe
                if E.z - 0.11 < r.z <= E.z + 0.025: return BLACK                                    # the mask, eye and cheek
            if r.z < E.z - 0.06 and n.z < 0.3: return ORANGE                                         # throat
            return SLATE
        if r.y > -0.06 and n.z < -0.35: return WHITE                                                 # undertail
        if side(n) and -0.42 < r.y < 0.34 and r.z > thrush_lower(r.y) and n.z < 0.6:                # the folded wing
            v = r.z - thrush_lower(r.y)
            if lv <= 1 and (-0.31 < r.y + 0.5 * v < -0.25 or -0.175 < r.y + 0.5 * v < -0.115): return ORANGE   # two wing bars
            if lv <= 1 and r.y > -0.08 and 0.03 < v < 0.08: return ORANGE                           # the stripe on the folded wing
            return WING
        if n.z > 0.25 or (r.y < -0.42 and r.z > 0.28 and n.y > -0.35): return SLATE
        if r.z > 0.36: return ORANGE                                                                 # upper breast
        if r.z > 0.24: return BLACK                                                                  # the breast band
        if r.z > -0.09 + 0.25 * max(0.0, r.y + 0.3): return ORANGE if not side(n, 0.75) else mix(ORANGE, SLATE, 0.45)   # lower breast, flanks
        return (SCAL if lv == 0 and bars(r.y + 0.4 * abs(r.x), 0.08, 0.3) else BELLY)                # grey-white belly, scalloped
    def tcol(t, lv): return SLATE, 0x5e6670
    def wcol(u, lv): return (ORANGE if lv == 0 and 0.62 < u < 0.75 else WING), 0x7a8088
    def hcol(v, lv): return (ORANGE if lv == 0 and 0.12 < v < 0.25 else WING), (0xd8a060 if lv == 0 and 0.1 < v < 0.3 else 0x7a8088)
    return dict(
        common='Varied thrush', name='varied_thrush', job=ROBIN_JOB, base='turdus_migratorius',
        length=0.24, tail_m=0.085, mass=0.078, tris=[1000, 400, 120],
        **thrush_geom(pitch=10.0), shoulder_x=0.022,
        legs=dict(knee_h=0.042, belly_h=0.032, legx=0.014, u=0.8, col=0xb08a70),
        eye_r=(0.0018, 0.0029, 0.0031),
        tail=dict(angle=-14.0, w0=0.011, w1=0.02, ridge=0.006, tip='square', n0=4, col=tcol),
        wing=dict(span=0.38, chord=1.05, hand='round', arm=wcol, hand_col=hcol, top=WING, under=0x7a8088),
        color=col, grizzle=0.06)


CHICK_EYE = V3(0, -0.755, 0.367)


def chick_lower(y): return 0.06 - 0.1 * (y + 0.3)                          # the chickadee source's folded wing


def chick_bill(r): return r.y < -0.83 and 0.27 < r.z < 0.38


def chick_geom(**kw):
    """The chickadee source's landmarks (raw), shared by the junco, kinglet and flycatcher."""
    g = dict(cut=lambda p: p.y > 0.36 or p.z < -0.265, reshape=[],
             hip=V3(0, -0.08, -0.10), pitch=0.0, belly=V3(0, -0.08, -0.265),
             neck=V3(0, -0.55, 0.25), head_dir=V3(0, -0.75, 0.66), head_band=(-0.03, 0.07),
             rump=V3(0, 0.33, 0.0), tail_dir=V3(0, 1, -0.3), eye=CHICK_EYE, shoulder=V3(0, -0.42, 0.22))
    g.update(kw); return g


def junco():
    HOOD, BACK, RUMP, FLANK, BELLY = 0x1f1e20, 0x7a4c30, 0x66686c, 0xc49a80, 0xefebe5
    WING, WEDGE, TAILC, BILL, LEG = 0x4e4a48, 0x7a5c48, 0x3a3a3e, 0xe6b6ae, 0xc89c90
    def col(r, n, lv, hw):
        if chick_bill(r): return BILL
        if hw > 0.5: return HOOD
        if r.y < -0.40 and r.z > 0.18 and n.z > -0.2: return HOOD                                    # the hood onto the nape
        if r.y < -0.45 and r.z > 0.02 and n.y < -0.2 and not side(n, 0.85): return HOOD              # and the upper breast
        if side(n) and -0.42 < r.y < 0.36 and r.z > chick_lower(r.y) and n.z < 0.6:                  # folded wing
            return WEDGE if lv == 0 and (r.z < chick_lower(r.y) + 0.04 or bars(r.z, 0.09, 0.2)) else WING
        if n.z > 0.2: return RUMP if r.y > 0.12 else BACK
        if side(n, 0.3) and r.y > -0.5: return FLANK
        return BELLY
    def tcol(t, lv): return TAILC, 0x5a5a5e
    def wcol(u, lv): return WING, 0x9a9a9c
    def hcol(v, lv): return WING, 0x9a9a9c
    return dict(
        common='Dark-eyed junco', name='junco', job=CHICK_JOB, base='poecile_rufescens',
        length=0.15, tail_m=0.065, mass=0.02, tris=[1000, 400, 120],
        **chick_geom(), shoulder_x=0.012,
        legs=dict(knee_h=0.024, belly_h=0.017, legx=0.009, u=0.55, col=LEG),
        eye_r=(0.0012, 0.0019, 0.002),
        tail=dict(angle=-12.0, w0=0.008, w1=0.013, ridge=0.003, tip='square', n0=4, col=tcol, edge=(0.32, BELLY, BELLY)),
        wing=dict(span=0.23, chord=1.05, hand='round', arm=wcol, hand_col=hcol, top=WING, under=0x9a9a9c),
        color=col, grizzle=0.06)


def kinglet():
    OLIVE, UNDER, FACE, BLACK, WHITE = 0x767a58, 0xd6d6c8, 0x8e9282, 0x161616, 0xeeeee8
    YELLOW, ORANGE, WING, YEDGE, BILL = 0xf2cc1e, 0xf08018, 0x3c3e34, 0xc2bc3c, 0x1a1a1a
    E = CHICK_EYE
    def col(r, n, lv, hw):
        if chick_bill(r): return BILL
        ax = abs(r.x)
        if hw > 0.5:
            if r.z > 0.435 and r.y > -0.80:                                                           # the crown
                if ax < 0.04: return ORANGE
                if ax < 0.08: return YELLOW
                if ax < 0.125: return BLACK
            if side(n, 0.3) and r.y > E.y - 0.06:
                if E.z + 0.022 < r.z <= 0.435: return WHITE                                           # the eyebrow
                if E.z - 0.022 < r.z <= E.z + 0.022: return BLACK                                     # the eye line
            if r.z < E.z - 0.05 and n.z < 0.2: return UNDER
            return FACE
        if r.y < -0.40 and r.z > 0.25 and n.z > 0: return OLIVE                                      # the nape
        if side(n) and -0.42 < r.y < 0.36 and r.z > chick_lower(r.y) and n.z < 0.6:                  # folded wing
            v = r.z - chick_lower(r.y)
            if lv <= 1 and (-0.34 < r.y + 0.3 * v < -0.29 or -0.20 < r.y + 0.3 * v < -0.15): return WHITE   # two wing bars
            return YEDGE if lv == 0 and r.y > -0.1 and bars(v, 0.06, 0.3) else WING                 # yellow feather edges
        if n.z > 0.2: return OLIVE
        if side(n, 0.45): return mix(UNDER, OLIVE, 0.35)
        return UNDER
    def tcol(t, lv): return mix(WING, YEDGE, 0.15), 0x8a8c80
    def wcol(u, lv): return (WHITE if lv == 0 and (0.12 < u < 0.25 or 0.5 < u < 0.62) else WING), 0xb0b2a8
    def hcol(v, lv): return (YEDGE if lv == 0 and 0.1 < v < 0.3 else WING), 0xb0b2a8
    return dict(
        common='Golden-crowned kinglet', name='kinglet', job=CHICK_JOB, base='poecile_rufescens',
        length=0.09, tail_m=0.035, mass=0.006, tris=[1000, 400, 120],
        **chick_geom(), shoulder_x=0.008,
        legs=dict(knee_h=0.016, belly_h=0.011, legx=0.006, u=0.36, col=0x3a342a),
        eye_r=(0.0009, 0.0014, 0.0015),
        tail=dict(angle=-14.0, w0=0.005, w1=0.0075, ridge=0.0015, tip='notch', n0=3, col=tcol),
        wing=dict(span=0.16, chord=1.1, hand='round', arm=wcol, hand_col=hcol, top=WING, under=0xb0b2a8),
        color=col, grizzle=0.05)


def fly_shape(p, sgn):
    """The flycatcher's head on the chickadee: a crown peaked at the back (z raised by a bump) and a broad bill (x
    widened toward the tip); y is unchanged, so the inverse solves z by a few fixed-point steps."""
    k = 1 + 0.9 * smooth(0.80, 0.86, -p.y)
    bump = lambda z: 0.085 * math.exp(-((p.y + 0.56) / 0.10) ** 2) * smooth(0.34, 0.47, z)
    if sgn > 0: return V3(p.x * k, p.y, p.z + bump(p.z))
    z = p.z
    for _ in range(8): z = p.z - bump(z)
    return V3(p.x / k, p.y, z)


def flycatcher():
    OLIVE, THROAT, BREAST, BELLY, WING = 0x75763f, 0xd8d27a, 0x9e9852, 0xe2d76a, 0x46463a
    BAR, TAILC, BILLT, BILLB = 0xd0c08c, 0x55543e, 0x2a2622, 0xdc8a3a
    E = CHICK_EYE
    def col(r, n, lv, hw):
        if chick_bill(r): return BILLT if n.z > 0.1 else BILLB
        if hw > 0.5:
            if r.z < E.z - 0.06 and n.z < 0.2 and not side(n, 0.85): return THROAT
            return OLIVE
        if side(n) and -0.42 < r.y < 0.36 and r.z > chick_lower(r.y) and n.z < 0.6:                  # folded wing, two bars
            v = r.z - chick_lower(r.y)
            if lv <= 1 and (-0.30 < r.y + 0.3 * v < -0.25 or -0.16 < r.y + 0.3 * v < -0.11): return BAR
            return WING
        if n.z > 0.2 or (r.y < -0.40 and r.z > 0.22 and n.z > 0): return OLIVE
        if r.y < -0.42 and r.z > 0.0: return BREAST                                                   # olive breast
        if side(n, 0.55): return mix(BELLY, OLIVE, 0.4)
        return BELLY
    def tcol(t, lv): return TAILC, 0x8a8660
    def wcol(u, lv): return (BAR if lv == 0 and (0.12 < u < 0.25 or 0.5 < u < 0.62) else WING), 0xb4b08a
    def hcol(v, lv): return WING, 0xa8a482
    return dict(
        common='Pacific-slope flycatcher', name='flycatcher', job=CHICK_JOB, base='poecile_rufescens',
        length=0.14, tail_m=0.06, mass=0.011, tris=[1000, 400, 120],
        **chick_geom(reshape=[(lambda p: fly_shape(p, 1), lambda p: fly_shape(p, -1))],
                     hip=V3(0, 0.15, -0.15), pitch=-30.0, belly=V3(0, 0.12, -0.25)), shoulder_x=0.011,
        legs=dict(knee_h=0.023, belly_h=0.017, legx=0.008, u=0.45, col=0x3a3a3c),
        eye_r=(0.0012, 0.0019, 0.002), eye_ring=(0xe8e2a8, (0.8, 1.6, 1.55), 0.35),
        tail=dict(angle=-62.0, w0=0.0065, w1=0.011, ridge=0.0025, tip='square', n0=4, col=tcol),
        wing=dict(span=0.21, chord=1.05, hand='round', arm=wcol, hand_col=hcol, top=WING, under=0xb4b08a),
        color=col, grizzle=0.05)


OWL_EYES = [V3(0.13, -0.36, 0.744), V3(-0.13, -0.36, 0.744)]


def owl_shape(kh):
    """A head widened kh times above the neck (as owl_head), as a reshape pair."""
    def f(p, sgn):
        k = 1 + (kh - 1) * smooth(0.36, 0.50, p.z)
        if sgn < 0: k = 1 / k
        return V3(p.x * k, -0.05 + (p.y + 0.05) * k, p.z)
    return [(lambda p: f(p, 1), lambda p: f(p, -1))]


def owl_geom(**kw):
    """The barred owl source's landmarks (raw), shared by the small owls."""
    g = dict(cut=lambda p: p.z < -0.53, reshape=[],
             hip=V3(0, 0.05, -0.30), pitch=10.0, belly=V3(0, 0.0, -0.53),
             neck=V3(0, -0.05, 0.42), head_dir=V3(0, -0.2, 0.98), head_band=(-0.03, 0.06),
             rump=V3(0, 0.32, -0.40), tail_dir=V3(0, 0.5, -0.85), eye=OWL_EYES[0], eye_front=True,
             shoulder=V3(0, 0.06, 0.32))
    g.update(kw); return g


def owl_disc(r, n):
    """(in the facial disc, distance to the nearer eye, that eye) for a raw point on the barred owl source's head."""
    e = min(OWL_EYES, key=lambda e: math.hypot(r.x - e.x, r.z - e.z))
    return n.y < -0.35 and r.y < -0.18 and r.z > 0.47, math.hypot(r.x - e.x, r.z - e.z), e


def owl_rim(r, d): return abs(r.x) > 0.255 or r.z > 0.905 or d > 0.215


def owl_billr(r): return abs(r.x) < 0.035 and 0.60 < r.z < 0.71


def screech_owl():
    GREY, DARK, PALE, DISC, RIM = 0x7a766e, 0x2a2826, 0xc6c2b8, 0x9e998f, 0x252321
    WHITE, BROW, BILLC, LEG, TALON = 0xe8e4dc, 0xc9c5bb, 0x3a3a3a, 0xbab2a4, 0x2a2420
    def col(r, n, lv, hw):
        if hw > 0.5:
            disc, d, e = owl_disc(r, n)
            if disc:
                if owl_billr(r): return BILLC
                if owl_rim(r, d): return RIM                                                            # the dark rim
                if r.z > e.z + 0.07 and abs(r.x) > 0.04: return BROW                                    # pale brows, into the tufts
                if lv == 0 and bars(d, 0.05, 0.3, -0.02): return mix(DISC, DARK, 0.35)                  # fine rings
                return DISC
            if lv == 0 and bars(r.x + 0.3 * r.y, 0.07, 0.22): return DARK                               # crown, streaked
            return GREY
        sc = r.x if abs(n.x) < 0.5 else r.y
        streak = lv <= 1 and bars(abs(sc), 0.13, 0.2, 0.03)                                              # black streaks
        cross = lv == 0 and bars(r.z, 0.07, 0.25)                                                        # fine cross-bars
        if n.y < -0.35 and r.y < -0.12 and abs(r.x) < 0.27:                                              # below: pale grey
            return DARK if streak else (mix(PALE, GREY, 0.5) if cross else PALE)
        if streak: return mix(GREY, DARK, 0.75)
        if cross: return mix(GREY, DARK, 0.4)
        return GREY
    def spots(r, n, lv, hw):   # the row of white scapular spots along the top of the folded wing
        if lv == 2 or hw > 0.3 or not side(n, 0.35) or n.y < -0.35: return None
        if -0.24 < r.y < 0.22 and abs(r.z - (0.33 - 0.37 * r.y)) < 0.085:                             # along the wing's top edge
            return WHITE if A.hash01(abs(r.x) // 0.03, r.y // 0.03, r.z // 0.03) < 0.6 else DARK
        return None
    def tcol(t, lv): return ((mix(GREY, PALE, 0.5), 0xd0ccc4) if lv == 0 and 0.08 < t < 0.97 and bars(t, 0.2, 0.35, 0.12) else (GREY, 0xaaa69e))
    def wcol(u, lv):
        dark = lv == 0 and bars(u, 0.2, 0.35, 0.05)
        return (mix(GREY, PALE, 0.5) if dark else GREY), (0xa8a49c if dark else 0xd8d4cc)
    def hcol(v, lv):
        dark = lv == 0 and bars(v, 0.2, 0.35, 0.05)
        return (mix(GREY, PALE, 0.5) if dark else mix(GREY, DARK, 0.25)), (0x9a968e if dark else 0xd8d4cc)
    return dict(
        common='Western screech-owl', name='screech_owl', job=OWL_JOB, base='strix_varia',
        length=0.22, height=0.22, tail_m=0.07, mass=0.15, tris=[1200, 450, 140],
        **owl_geom(reshape=owl_shape(1.05)), shoulder_x=0.03,
        legs=dict(knee_h=0.028, belly_h=0.02, legx=0.016, u=0.75, col=LEG, toe=LEG, talon=TALON, feathered=True),
        eye_r=(0.0078, 0.0018, 0.0078), eye_col=0xf0c41c, pupil=(0x0c0a0a, 0.5),
        bill=dict(at=V3(0, -0.37, 0.66), dir=V3(0, -0.6, -0.8), length=0.009, radius=0.0027, col=BILLC),
        tufts=dict(at=V3(0.155, -0.24, 0.92), dir=V3(0.35, 0.15, 1.0), length=0.015, radius=0.0068, col=mix(GREY, DARK, 0.45)),
        tail=dict(angle=-55.0, w0=0.016, w1=0.022, ridge=0.0035, tip='round', n0=8, col=tcol),
        wing=dict(span=0.56, chord=1.3, hand='broad', arm=wcol, hand_col=hcol, top=GREY, under=0xd8d4cc),
        color=col, spots=spots, grizzle=0.06)


def saw_whet_owl():
    BROWN, WHITE, DISC, STREAK, RUST = 0x734b2d, 0xefe9de, 0xe4d9c8, 0x8a6244, 0x93532f
    BILLC, LEG, TALON = 0x161414, 0xe2d6c0, 0x2a2420
    def col(r, n, lv, hw):
        if hw > 0.5:
            disc, d, e = owl_disc(r, n)
            if disc:
                if owl_billr(r): return BILLC
                if owl_rim(r, d): return (WHITE if lv == 0 and r.z > 0.84 and bars(r.x, 0.05, 0.3) else BROWN)   # the forehead, streaked
                if abs(r.x) < 0.035: return WHITE                                                       # the Y's stem
                if r.z > e.z + 0.045 and d < 0.14: return WHITE                                         # the Y's arms, over the eyes
                if d < 0.05: return mix(DISC, BROWN, 0.45)
                ang = math.atan2(r.z - e.z, r.x - e.x)
                return STREAK if lv <= 1 and bars(ang, 2 * math.pi / 12, 0.35) else DISC                # radiating streaks
            return BROWN
        if n.y < -0.35 and r.y < -0.12 and abs(r.x) < 0.27:                                              # below: white streaked rust
            return RUST if lv <= 1 and bars(abs(r.x), 0.15, 0.45, 0.025) else WHITE
        return BROWN
    def spots(r, n, lv, hw):   # white spots on the crown and back
        if lv == 2: return None
        if hw > 0.5 and owl_disc(r, n)[0]: return None
        if n.y < -0.35 and r.y < -0.12 and abs(r.x) < 0.27: return None
        h = A.hash01(abs(r.x) // 0.02, r.y // 0.02, r.z // 0.02)
        return WHITE if h < (0.16 if hw > 0.5 else 0.2) else None
    def tcol(t, lv): return ((WHITE, WHITE) if lv == 0 and 0.15 < t < 0.95 and bars(t, 0.28, 0.16, 0.1) else (BROWN, 0xc8b8a4))
    def wcol(u, lv): return (mix(BROWN, WHITE, 0.55) if lv == 0 and int(u * 8) in (2, 5) else BROWN), 0xe0d4c4   # rows of white spots
    def hcol(v, lv): return (mix(BROWN, WHITE, 0.5) if lv == 0 and int(v * 8) in (2, 5) else mix(BROWN, 0x3a2818, 0.25)), 0xd0c2b0
    return dict(
        common='Northern saw-whet owl', name='saw_whet_owl', job=OWL_JOB, base='strix_varia',
        length=0.2, height=0.20, tail_m=0.06, mass=0.08, tris=[1200, 450, 140],
        **owl_geom(reshape=owl_shape(1.22)), shoulder_x=0.03,
        legs=dict(knee_h=0.025, belly_h=0.018, legx=0.015, u=0.7, col=LEG, toe=LEG, talon=TALON, feathered=True),
        eye_r=(0.0082, 0.0018, 0.0082), eye_col=0xf0c01c, pupil=(0x0c0a0a, 0.5),
        bill=dict(at=V3(0, -0.37, 0.66), dir=V3(0, -0.6, -0.8), length=0.008, radius=0.0025, col=BILLC),
        tail=dict(angle=-55.0, w0=0.014, w1=0.02, ridge=0.003, tip='round', n0=8, col=tcol),
        wing=dict(span=0.48, chord=1.3, hand='broad', arm=wcol, hand_col=hcol, top=BROWN, under=0xe0d4c4),
        color=col, spots=spots, spot_max=0.009, grizzle=0.06)


RECIPES = {'troglodytes_pacificus': wren, 'perisoreus_canadensis': grayjay, 'poecile_rufescens': chickadee,
           'strix_varia': owl, 'megaceryle_alcyon': kingfisher,
           'turdus_migratorius': robin, 'sturnus_vulgaris': starling, 'ixoreus_naevius': varied_thrush,
           'junco_hyemalis': junco, 'regulus_satrapa': kinglet, 'empidonax_difficilis': flycatcher,
           'megascops_kennicottii': screech_owl, 'aegolius_acadicus': saw_whet_owl}
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
    if 'spots' in R:   # whole-face spots (the starling's, the owls'), decided at the face centre so they stay crisp
        sp = R['spots'](r0, rn, level, head_w(r0))
        if sp is not None:   # a face bigger than a spot takes it weaker (a speckled face, not a pale patch)
            size = max((q - c).length for q in corners) if corners else 0.0
            a, b = pair(sp); la, lb = A.srgb2lin(a), A.srgb2lin(b); f = min(1.0, R.get('spot_max', 1.0) / max(size, 1e-6)) ** 2.2   # (a linear mix: ~perceptual weight ** 2.2)
            sa = [sa[i] + (la[i] - sa[i]) * f for i in range(3)]; sb = [sb[i] + (lb[i] - sb[i]) * f for i in range(3)]
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
    rnd = T['tip'] == 'round'; notch = T['tip'] == 'notch'
    edge = T.get('edge') if level < 2 else None
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
        last = i == len(ts) - 2
        if tip:
            ex.quad([l0, m0, m1], top, rig, up, tri=True); ex.quad([m0, r0, m1], top, rig, up, tri=True)
            ex.quad([l0, r0, m1], under, rig, -up, tri=True)
        elif notch and last:   # a notched end: the centre pulled back, a point at each corner
            nb = d * (0.12 * Lt); m1n = m1 - nb; c1n = c1 - nb
            ex.quad([l0, l1, m1n, m0], top, rig, up + X * 0.3); ex.quad([m0, m1n, r1, r0], top, rig, up - X * 0.3)
            ex.quad([l0, l1, c1n, c0], under, rig, -up); ex.quad([c0, c1n, r1, r0], under, rig, -up)
            ex.quad([l1, m1n, c1n], top, rig, d, tri=True); ex.quad([m1n, r1, c1n], top, rig, d, tri=True)
        elif edge:             # the outer tail feathers in their own colour, above and below
            f, et, eu = edge
            a0, a1 = l0.lerp(m0, f), l1.lerp(m1, f); b0, b1 = r0.lerp(m0, f), r1.lerp(m1, f)
            ex.quad([l0, l1, a1, a0], et, rig, up + X * 0.5); ex.quad([a0, a1, m1, m0], top, rig, up + X * 0.2)
            ex.quad([m0, m1, b1, b0], top, rig, up - X * 0.2); ex.quad([b0, b1, r1, r0], et, rig, up - X * 0.5)
            g0, g1 = l0.lerp(r0, f / 2), l1.lerp(r1, f / 2); h0, h1 = r0.lerp(l0, f / 2), r1.lerp(l1, f / 2)
            ex.quad([l0, l1, g1, g0], eu, rig, -up); ex.quad([g0, g1, h1, h0], under, rig, -up); ex.quad([h0, h1, r1, r0], eu, rig, -up)
            if last: ex.quad([l1, m1, r1], et, rig, d, tri=True)
        else:
            ex.quad([l0, l1, m1, m0], top, rig, up + X * 0.3); ex.quad([m0, m1, r1, r0], top, rig, up - X * 0.3)
            ex.quad([l0, l1, r1, r0], under, rig, -up)
            if not rnd and last:   # the square end: close the ridge
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


def eyes(ex, level=0):
    er = Vector(R['eye_r']); col = R.get('eye_col', 0x0a0a0c)
    for s in (1, -1):
        if R.get('eye_front'):   # an owl's forward eye: a shallow eight-sided cone standing just proud of the face disc
            c = Vector((s * abs(EYE_SURF.x), EYE_SURF.y - er.y, EYE_SURF.z))
            nrm = Vector((s * 0.25, -1, 0)).normalized(); u = Vector((0, 0, 1)); w = nrm.cross(u).normalized()
            ring = [c + (w * math.cos(2 * math.pi * k / 8) + u * math.sin(2 * math.pi * k / 8)) * er.x for k in range(8)]
            apex = c + nrm * er.y
            for k in range(8): ex.quad([ring[k], ring[(k + 1) % 8], apex], col, (HEAD, 1.0, NECK), nrm, tri=True)
            if R.get('pupil') and level < 2:   # the pupil: the middle of the cone, raised a little, black
                pc, fr = R['pupil']; lift = nrm * (0.25 * er.y)
                pr = [c + nrm * (er.y * (1 - fr)) + lift + (w * math.cos(2 * math.pi * k / 8) + u * math.sin(2 * math.pi * k / 8)) * (er.x * fr) for k in range(8)]
                for k in range(8): ex.quad([pr[k], pr[(k + 1) % 8], apex + lift], pc, (HEAD, 1.0, NECK), nrm, tri=True)
            continue
        c = Vector((s * (EYE_SURF.x - 0.4 * er.x), EYE_SURF.y, EYE_SURF.z))
        if R.get('eye_ring'):    # a pale ring: a flatter, wider ellipsoid just behind the eye (set back for a teardrop)
            rc, (kx, ky, kz), back = R['eye_ring']
            ex.ellipsoid(Vector((s * (EYE_SURF.x - 0.55 * er.x), EYE_SURF.y + back * er.y, EYE_SURF.z)),
                         Vector((er.x * kx, er.y * ky, er.z * kz)), rc, (HEAD, 1.0, NECK))
        ex.ellipsoid(c, er, col, (HEAD, 1.0, NECK))


def bill(ex, level):
    B = R.get('bill')
    if not B: return
    base = M(lm(B['at'])); hit = bvh.ray_cast(V3(0, base.y - 0.3, base.z), V3(0, 1, 0))[0]
    if hit: base = hit + Vector((0, 0.3 * B['radius'], 0))
    d = Vector(B['dir']).normalized()
    ex.tube([base, base + d * B['length']], [B['radius'], 0], B['col'], (HEAD, 1.0, NECK), sides=4 if level < 2 else 3)


def tufts(ex, level):
    """Ear tufts: a short four-sided horn each side of the crown, set into the head (the raw point given for +x)."""
    T = R.get('tufts')
    if not T: return
    for s in (1, -1):
        at = M(lm(T['at'])); at.x *= s
        hit = bvh.ray_cast(V3(at.x, at.y, at.z + 0.3), V3(0, 0, -1))[0]
        if hit: at = hit
        d = Vector((s * T['dir'].x, T['dir'].y, T['dir'].z)).normalized()
        ex.tube([at - d * (0.6 * T['radius']), at + d * T['length']], [T['radius'], 0], T['col'], (HEAD, 1.0, NECK), sides=4 if level < 2 else 3)


# ---- tiers ----
def build(level, target):
    global V
    ex = Extra(); legs(ex, level); tail(ex, level); wings(ex, level); bill(ex, level); tufts(ex, level)
    if level == 0 or R.get('eye_front'): eyes(ex, level)
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
BASE = R.get('base')      # a free variant: another species' Meshy source, reshaped and recoloured (no credits)
SOURCE = {'kind': 'variant' if BASE else 'meshy', 'job_id': JOB, 'ai_model': 'meshy-6-lite', 'mode': 'text-to-3d preview',
          'generator': 'Khronos glTF Blender I/O (Meshy export)', 'ai_generated': True,
          'meshy_metadata': 'none embedded in the source GLB'}
if BASE: SOURCE.update(variant_of=BASE, credits=0)
write_glb(OUT, tiers, 'wild-earth tools/build_songbird.py (Blender)',
          (f"{R['common']}: a variant of {BASE} built from its source, " if BASE else f"{R['common']}: ") +
          f"generated with Meshy (meshy.ai), task {JOB}, owned by the account holder (Aaron Brodeur), CC BY-SA 4.0; rebuilt (tail and legs replaced, reshaped, recoloured, decimated, wing cards added) by wild-earth tools/build_songbird.py --species {SPECIES}",
          extras={'species': SPECIES, 'rig': RIG, 'source': SOURCE})

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
