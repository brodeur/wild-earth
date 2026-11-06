# Build client/assets/cascades_frog.glb, the Cascades frog (Rana cascadae) of the Olympic Mountains' subalpine ponds,
# wet meadows and streams, a variant of the western toad built by tools/build_toad.py's build() from the same mesh.
# No credits.
#
# Source: variant of anaxyrus_boreas built from the western toad's Meshy source, no new job. That source: generated with
#   Meshy (meshy.ai), text-to-3D preview, ai_model meshy-6-lite, triangle remesh to 20,000 faces (untextured), task
#   01a1ae8d-0b79-7550-84cb-9b7d4e6f1127, run by agent (Claude) for Aaron Brodeur on 2026-11-06 01:50 UTC (the 2026-11-05
#   batch), 5 credits charged to the toad. Prompt (for the toad): "A western toad (Anaxyrus boreas), NOT a frog, NOT a
#   cartoon. One adult sitting on the ground in a neutral crouch, side-on pose, the four legs folded under it, the front
#   feet planted. Realistic proportions: 10 cm long, a squat broad warty body, a blunt rounded head with big oval
#   parotoid glands behind the eyes, golden eyes with horizontal pupils, short thick legs. Olive-grey to greenish brown
#   skin with dark warts ringed in rusty brown, a thin pale cream stripe down the middle of the back, a pale mottled
#   belly. No base, no ground. Game-ready, clean closed mesh." Record:
#   library/animals/jobs/anaxyrus_boreas/01a1ae8d-0b79-7550-84cb-9b7d4e6f1127/job.json.
# Licence: paid-plan API output, owned by the account holder (Meshy Terms of Use 3.2, https://www.meshy.ai/terms-of-use,
#   last updated 2026-09-19), released with the project's assets under CC BY-SA 4.0; credit "generated with Meshy
#   (meshy.ai)". Terms 2.4: the mesh carried no Meshy metadata to keep (asset.generator only).
#
# Rebuild (Blender 4.1, from the repo root):
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/build_frog.py -- \
#       library/animals/jobs/anaxyrus_boreas/01a1ae8d-0b79-7550-84cb-9b7d4e6f1127/model.glb client/assets/cascades_frog.glb
#
# What it does: tools/build_toad.py's build (the crouch's limb regions, pivots, the vent stubs and the reptile template's
# rig and extras) with the frog's shape: the warty skin smoothed flat (Laplacian smoothing of the whole mesh, 14
# passes); the hind legs 1.35x longer fore and aft about the hip (1.08x outward); the snout ahead of the eyes drawn out 1.25x and narrowed to a point;
# the dorsolateral folds raised as low ridges along each side of the back; scaled smaller and slimmer (snout to vent
# 0.065 m, the trunk 3.0 cm across, the back ~2.2 cm up). No mid-dorsal stripe, no warts. Colour by region (sRGB palette,
# faint per-face noise): olive-brown to tan above with crisp black spots (hashed small faces) on the back and legs, the
# pale dorsolateral folds, a dark mask behind the eye bordered below by a pale jaw stripe, golden eyes with a dark
# horizontal pupil (lod0), yellow under the hind legs, a cream belly. Decimates (collapse, X symmetry) to lod0 ~1,200,
# lod1 ~400, lod2 ~120 triangles. Rig and extras.rig exactly as tools/build_toad.py (the reptile template: BODY 0,
# LEG_A 1, LEG_B 2, HEAD 6, TAIL 3 and TAIL_TIP 8 tiny stubs at the vent; _BLUE 0; extras.rig head, tail, tail_tip, fore,
# hind, legs, snout_z, vent_z, tail_end_z, belly_y, back_y, drop, blue_off, throat_off, length_m; tail_end_z 5 snout-vent
# lengths behind the snout so the spine wave stays tiny).
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_toad as T

FROG = dict(
    kind='frog', species='rana_cascadae', name='Cascades frog', script='tools/build_frog.py', variant_of='anaxyrus_boreas',
    job='01a1ae8d-0b79-7550-84cb-9b7d4e6f1127', credits=0,
    tiers=[('lod0', 1200), ('lod1', 400), ('lod2', 120)],
    svl=0.065, width=0.030, back=0.022,
    smooth=14, hind_legs=(1.08, 1.35, 1.0), snout=1.25, snout_taper=0.35, slim=1.0, folds=0.03,
    stripe_half=0.0,
    note='skin smoothed, hind legs lengthened, snout pointed, dorsolateral folds raised, recoloured, decimated; tail stubs at the vent',
    palette=dict(base=0x8a7450, base2=0x7a6644, spot=0x15120e, spot_frac=0.13, fold=0xcdbd8e, mask=0x3a2a1c, jaw=0xdcd0ac,
                 eye=0xc09838, pupil=0x0a0806, belly=0xe2d8bc, thigh_under=0xd8b438, stripe=0xe2d6aa),
)

if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:]
    T.build(FROG, argv[0], argv[1])
