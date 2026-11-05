# Build client/assets/ensatina.glb, the ambient Oregon ensatina (Ensatina eschscholtzii oregonensis), a variant of the
# western red-backed salamander built by tools/build_salamander.py's build() from the same mesh.
#
# Source: variant of plethodon_vehiculum built from the red-backed salamander's Meshy source, no credits. That source:
# generated with Meshy (meshy.ai), text-to-3D preview, ai_model "meshy-6-lite", triangle remesh to 20,000 faces, task
# 01a1ad3a-5ecd-7016-9b71-8d57ee3f76e9 ("A western red-backed salamander (Plethodon vehiculum), a small slender woodland
# salamander, NOT a lizard, NOT a newt, no scales, smooth moist skin. One adult walking on the ground, side-on pose, body
# straight, four short thin legs splayed out to the sides with small toes. ..."; the whole prompt is in the job record),
# run by agent (Claude) for Aaron Brodeur on 2026-11-05 UTC. Record (prompt, cost, checksums):
# library/animals/jobs/plethodon_vehiculum/01a1ad3a-5ecd-7016-9b71-8d57ee3f76e9/job.json. Paid-plan API output, owned by
# the account holder (Meshy Terms of Use 3.2) and released with the project's assets under CC BY-SA 4.0; credit
# "generated with Meshy (meshy.ai)". The mesh carried no Meshy metadata to keep (Terms 2.4: asset.generator only).
#
# Rebuild (Blender 4.1, from the repo root):
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P tools/build_ensatina.py -- \
#       library/animals/jobs/plethodon_vehiculum/01a1ad3a-5ecd-7016-9b71-8d57ee3f76e9/model.glb client/assets/ensatina.glb
#
# What it does: tools/build_salamander.py's build (the body recentred, limbs and their rings found from the geometry,
# the curled tail carried onto a straight axis on the midline and laid down behind, scaled to the brief), with the
# ensatina's build: stouter and a little bigger (snout to vent 0.055 m, the tail 0.055 m, 1.1 cm across, the back ~8 mm
# before the legs lift it); the limbs 1.3x longer about their shoulder and hip rings (the body stands higher on them);
# the eyes bigger and protruding (the head's skin round each eye pushed out 1.45x about a point inside it); the tail
# constricted at its base (pinched to ~70% of its width just behind the vent, then swollen 1.15x through its inner half,
# tapering to the tip). No stripe cut: plain above. Colour (the Oregon subspecies) by region with faint per-face noise:
# plain brown to reddish-brown above finely flecked darker (hashed small faces), slightly darker brown sides, the limb
# bases yellowish-orange, the belly pale whitish-yellow with fine dark specks, big black eyes (the faces within the eye's
# radius on lod0 and lod1) with a yellow-cream fleck above each. Decimates (collapse, X symmetry) to lod0 ~800, lod1 ~300,
# lod2 ~80 triangles. Rig and extras.rig: the reptile template exactly as tools/build_salamander.py (BODY 0, LEG_A 1,
# LEG_B 2, HEAD 6, TAIL 3, TAIL_TIP 8; _BLUE 0 everywhere; extras.rig head, tail, tail_tip, fore, hind, legs, snout_z,
# vent_z, tail_end_z, belly_y, back_y, drop, blue_off, throat_off, length_m).
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import animal_glb as A
import build_salamander as BS


def constrict(t):
    """The tail's radial scale by arc fraction: pinched just behind the vent, swollen behind it, tapering to the tip."""
    pinch = 0.36 * math.exp(-((t - 0.05) / 0.045) ** 2)
    swell = 1.0 + 0.15 * (1 - A.smooth(0.45, 0.85, t))
    return swell - pinch


ENSATINA = dict(
    species='ensatina_eschscholtzii', name='Oregon ensatina', script='tools/build_ensatina.py',
    job='01a1ad3a-5ecd-7016-9b71-8d57ee3f76e9', variant_of='plethodon_vehiculum',
    tiers=[('lod0', 800), ('lod1', 300), ('lod2', 80)],
    svl=0.055, tail=0.055, width=0.011, back=0.008,
    stripe_half=0.0034, cut=False,           # no stripe edges: the whole back takes the dorsal colour
    legs=1.3, constrict=constrict, eye_scale=1.45, eye_r=0.0013, eye_fleck=True,
    note='variant of the red-backed salamander: stouter, limbs longer, eyes bigger, tail constricted at the base, recoloured, decimated',
    palette=dict(
        stripe=0x7a4a2c, stripe_fleck=0x4e2e1b, back_fleck=0.22, side=0x6b4027, side_fleck=0x452a1a, fleck=0.2, fleck_area=2.5e-6,
        belly=0xe2d8b4, belly_pale=0x5a4c3c, mottle=0.12,
        eye=0x080707, eye_fleck=0xe8dc98, head_top=0x6f4329,
        limb=0x6e4429, limb_under=0xb08a5a, limb_top=0xd08a3a, limb_top_r=0.0016, limb_top_nz=-0.6, limb_base_dy=0.003,
    ),
)

if __name__ == '__main__':
    argv = sys.argv[sys.argv.index('--') + 1:]
    BS.build(ENSATINA, argv[0], argv[1])
