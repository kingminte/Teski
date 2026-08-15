// AUDITORÍA (solo lectura, NO muta) del vínculo cheque ↔ movimiento.
//
// El vínculo vive en dos columnas que deben moverse juntas:
//     cheques.movimiento_id  ↔  movimientos.cheque_id
// Este script lista todo lo que rompa ese espejo. Salida vacía = todo sano.
// Correrlo después de cada calce/descalce para confirmar que no quedó un lado suelto.
//
// Uso: node scripts/auditar-vinculo-cheques.mjs
import fs from 'fs'

const env = {}
for (const l of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const i = l.indexOf('='); if (i < 0) continue
  env[l.slice(0, i).trim()] = l.slice(i + 1).trim()
}
const BASE = env.VITE_SUPABASE_URL, KEY = env.VITE_SUPABASE_ANON_KEY
const h = { apikey: KEY, Authorization: 'Bearer ' + KEY }
const get = async (q) => (await fetch(BASE + '/rest/v1/' + q, { headers: h })).json()
const fmt = (f) => f ? f.split('-').reverse().join('/') : '—'

const main = async () => {
  const cheques = await get('cheques?select=id,numero,estado,monto,movimiento_id,fecha_deposito,fecha_documento,concepto')
  const movs = await get('movimientos?select=id,fecha,descripcion,monto,tipo,estado,cheque_id,monto_conciliado,monto_pendiente')
  const chById = Object.fromEntries(cheques.map(c => [c.id, c]))
  const movById = Object.fromEntries(movs.map(m => [m.id, m]))
  const fallas = []

  // 1. Cheque que apunta a un movimiento que no le devuelve el apunte.
  for (const c of cheques.filter(c => c.movimiento_id)) {
    const m = movById[c.movimiento_id]
    if (!m) { fallas.push(`cheque N°${c.numero} → movimiento inexistente ${c.movimiento_id}`); continue }
    if (m.cheque_id !== c.id) {
      const otro = m.cheque_id ? `N°${chById[m.cheque_id]?.numero ?? m.cheque_id}` : 'NULL'
      fallas.push(`ESPEJO ROTO: cheque N°${c.numero} → mov ${fmt(m.fecha)}, pero mov.cheque_id = ${otro}`)
    }
    if (m.estado !== 'conciliado') {
      fallas.push(`CHEQUE EN LIMBO: N°${c.numero} amarrado a mov ${fmt(m.fecha)} que está '${m.estado}'`)
    }
    if (c.estado !== 'depositado') {
      fallas.push(`cheque N°${c.numero} amarrado a mov ${fmt(m.fecha)} pero su estado es '${c.estado}'`)
    }
  }

  // 2. Movimiento que apunta a un cheque que no le devuelve el apunte.
  for (const m of movs.filter(m => m.cheque_id)) {
    const c = chById[m.cheque_id]
    if (!c) { fallas.push(`mov ${fmt(m.fecha)} → cheque inexistente ${m.cheque_id}`); continue }
    if (c.movimiento_id !== m.id) {
      fallas.push(`ESPEJO ROTO: mov ${fmt(m.fecha)} → cheque N°${c.numero}, que apunta a ${c.movimiento_id ? 'otro movimiento' : 'NULL'}`)
    }
  }

  // 3. Doble amarre: dos o más cheques sobre el mismo movimiento.
  const porMov = {}
  for (const c of cheques.filter(c => c.movimiento_id)) (porMov[c.movimiento_id] ??= []).push(c.numero)
  for (const [movId, nums] of Object.entries(porMov)) {
    if (nums.length > 1) fallas.push(`DOBLE AMARRE: mov ${fmt(movById[movId]?.fecha)} tiene los cheques ${nums.join(', ')}`)
  }

  console.log(`cheques: ${cheques.length} · movimientos: ${movs.length}`)
  console.log(`amarrados: ${cheques.filter(c => c.movimiento_id).length} cheques ↔ ${movs.filter(m => m.cheque_id).length} movimientos`)

  console.log('\n— Candidatos visibles (sin movimiento, no anulados) —')
  for (const c of cheques.filter(c => !c.movimiento_id && c.estado !== 'anulado')) {
    console.log(`  N°${c.numero} $${c.monto} ${c.estado} · dep ${fmt(c.fecha_deposito)} · doc ${fmt(c.fecha_documento)}`)
  }

  console.log(`\n— Inconsistencias: ${fallas.length} —`)
  for (const f of fallas) console.log('  ✗ ' + f)
  if (fallas.length === 0) console.log('  ✓ vínculo cheque ↔ movimiento consistente en ambos lados')
}
main().catch(e => { console.error('AUDITORÍA error:', e.message); process.exit(1) })
