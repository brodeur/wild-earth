import {
  buildRaven, buildWoodpecker, loadDeerMesh, loadFoxMesh, loadCoyoteMesh, loadCougarMesh, loadSquirrelMesh,
  loadGroundSquirrelMesh, loadRabbitMesh, loadJackrabbitMesh, loadVoleMesh, loadQuailMesh, loadTurkeyMesh,
  loadLizardMesh, loadJayMesh, loadStellersJayMesh, loadRedtailMesh, loadVultureMesh, loadBearMesh,
  loadMountainQuailMesh, loadElkCowMesh, loadBobcatMesh, loadOtterMesh, loadHareMesh, loadDouglasSquirrelMesh,
  loadChipmunkMesh, loadDeerMouseMesh, loadWrenMesh, loadGrayJayMesh, loadChickadeeMesh, loadOwlMesh,
  loadKingfisherMesh, loadEagleMesh, loadCrowGroundMesh, loadHeronMesh, loadMerganserMesh, loadSalamanderMesh,
  loadEnsatinaMesh, buildSlug, loadRobinMesh, loadStarlingMesh, loadVariedThrushMesh, loadJuncoMesh, loadKingletMesh,
  loadFlycatcherMesh, loadScreechOwlMesh, loadSawWhetOwlMesh, loadOspreyMesh, loadSharpShinnedMesh, loadMerlinMesh,
  loadGlaucousGullMesh, loadCaliforniaGullMesh, loadWesternGullMesh, loadMallardMesh, loadGrouseMesh, loadMarmotMesh,
  loadYellowPineChipmunkMesh, loadShrewMesh, loadToadMesh, loadFrogMesh, buildHairyWoodpecker,
} from './animalModels.js';

// The drawn model of each species the client draws (animalModels.js), and how it is posed when seen alone: shared by the
// opening screen's stills (client/tools/opening_sprites.js renders one per species) and the home screen's rings of bodies
// (bodyRing.js, live). MODELS[code] = [kind, load, pose = 0, soar]: kind G a ground animal standing (pose 1 the folded-wing
// birds' pose), B a bird on the wing (soar: a soarer's flat wings); load() the model (animalModels.js: tiers or a geometry).
export const G = 'ground', B = 'bird';
export const MODELS = {
  odocoileus_hemionus: [G, loadDeerMesh], ursus_americanus: [G, loadBearMesh], puma_concolor: [G, loadCougarMesh], canis_latrans: [G, loadCoyoteMesh],
  urocyon_cinereoargenteus: [G, loadFoxMesh], meleagris_gallopavo: [G, loadTurkeyMesh, 1], lepus_californicus: [G, loadJackrabbitMesh],
  sciurus_griseus: [G, loadSquirrelMesh], otospermophilus_beecheyi: [G, loadGroundSquirrelMesh], sylvilagus_bachmani: [G, loadRabbitMesh],
  callipepla_californica: [G, loadQuailMesh, 1], oreortyx_pictus: [G, loadMountainQuailMesh, 1], sceloporus_occidentalis: [G, loadLizardMesh], microtus_californicus: [G, loadVoleMesh],
  corvus_corax: [B, async () => buildRaven()], buteo_jamaicensis: [B, loadRedtailMesh, 0, 'soar'], cathartes_aura: [B, loadVultureMesh, 0, 'soar'],
  aphelocoma_californica: [B, loadJayMesh], cyanocitta_stelleri: [B, loadStellersJayMesh], melanerpes_formicivorus: [B, async () => buildWoodpecker()],
  // the Hoh rain forest batch (2026-11-05)
  cervus_canadensis: [G, loadElkCowMesh], lynx_rufus: [G, loadBobcatMesh], lontra_canadensis: [G, loadOtterMesh], lepus_americanus: [G, loadHareMesh],
  tamiasciurus_douglasii: [G, loadDouglasSquirrelMesh], tamias_townsendii: [G, loadChipmunkMesh], peromyscus_maniculatus: [G, loadDeerMouseMesh],
  plethodon_vehiculum: [G, loadSalamanderMesh], ensatina_eschscholtzii: [G, loadEnsatinaMesh], ariolimax_columbianus: [G, async () => buildSlug()],
  ardea_herodias: [G, loadHeronMesh], mergus_merganser: [G, loadMerganserMesh], corvus_brachyrhynchos: [G, loadCrowGroundMesh],
  troglodytes_pacificus: [B, loadWrenMesh], perisoreus_canadensis: [B, loadGrayJayMesh], poecile_rufescens: [B, loadChickadeeMesh],
  strix_varia: [B, loadOwlMesh], megaceryle_alcyon: [B, loadKingfisherMesh], haliaeetus_leucocephalus: [B, loadEagleMesh, 0, 'soar'],
  // the second batch (2026-11-06)
  turdus_migratorius: [G, loadRobinMesh], sturnus_vulgaris: [G, loadStarlingMesh], ixoreus_naevius: [G, loadVariedThrushMesh], junco_hyemalis: [G, loadJuncoMesh],
  regulus_satrapa: [B, loadKingletMesh], empidonax_difficilis: [B, loadFlycatcherMesh], megascops_kennicottii: [B, loadScreechOwlMesh],
  aegolius_acadicus: [B, loadSawWhetOwlMesh], leuconotopicus_villosus: [B, async () => buildHairyWoodpecker()],
  pandion_haliaetus: [B, loadOspreyMesh, 0, 'soar'], accipiter_striatus: [B, loadSharpShinnedMesh, 0, 'soar'], falco_columbarius: [B, loadMerlinMesh, 0, 'soar'],
  larus_glaucescens: [B, loadGlaucousGullMesh, 0, 'soar'], larus_californicus: [B, loadCaliforniaGullMesh, 0, 'soar'], larus_occidentalis: [B, loadWesternGullMesh, 0, 'soar'],
  anas_platyrhynchos: [G, loadMallardMesh], dendragapus_fuliginosus: [G, loadGrouseMesh], marmota_olympus: [G, loadMarmotMesh],
  tamias_amoenus: [G, loadYellowPineChipmunkMesh], sorex_monticolus: [G, loadShrewMesh], anaxyrus_boreas: [G, loadToadMesh], rana_cascadae: [G, loadFrogMesh],
};
