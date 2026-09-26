import { NodeIO } from '@gltf-transform/core';
const io = new NodeIO();
const d = await io.read(process.argv[2]);
const r = d.getRoot();
const skin = r.listSkins()[0];
const joints = new Set(skin.listJoints());
function walk(n, depth) {
  const t = n.getTranslation().map(v=>v.toFixed(3)), rr = n.getRotation().map(v=>v.toFixed(2)), s=n.getScale().map(v=>v.toFixed(2));
  console.log(' '.repeat(depth*2) + n.getName(), joints.has(n)?'J':'', 't', t.join(','), 'r', rr.join(','), 's', s.join(','), n.getMesh()?'MESH:'+n.getMesh().getName():'');
  for (const c of n.listChildren()) walk(c, depth+1);
}
for (const n of r.listScenes()[0].listChildren()) walk(n, 0);
for (const m of r.listMeshes()) { const p=m.listPrimitives()[0]; const pos=p.getAttribute('POSITION'); console.log('mesh', m.getName(), pos.getCount(), 'min', pos.getMin([]).map(v=>v.toFixed(2)), 'max', pos.getMax([]).map(v=>v.toFixed(2))); }
