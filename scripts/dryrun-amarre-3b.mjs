// DRY-RUN (solo lectura, NO muta) del auto-amarre 3B.
// Para cada movimiento "Depósito Documento …" existente, y para los cheques de
// junio (simulando su depósito), imprime qué cheque ELEGIRÍA el algoritmo:
//   socio_id = socio del movimiento
//   AND monto = abs(movimiento.monto)
//   AND estado = 'depositado' AND movimiento_id IS NULL
//   desempate: |fecha_deposito - movimiento.fecha| (Date.UTC, sin timezone bug)
// Uso: node scripts/dryrun-amarre-3b.mjs
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
const dias = (f) => { const [y, m, d] = f.split('-').map(Number); return Date.UTC(y, m - 1, d) / 86400000 }
const esDepositoDeCheque = (m) => !m.rut_detectado && /dep[óo]sito\s+documento/i.test(m.descripcion || '')

const elegir = (pool, socioId, monto, fechaMov) => {
  const cands = pool.filter(c => c.socio_id === socioId && c.monto === monto)
  if (cands.length <= 1) return { n: cands.length, pick: cands[0] || null }
  const cd = cands.map(c => ({ c, dist: Math.abs(dias(c.fecha_deposito) - dias(fechaMov)) })).sort((a, b) => a.dist - b.dist)
  const empate = cd[0].dist === cd[1].dist
  return { n: cd.length, pick: empate ? null : cd[0].c, empate }
}

const main = async () => {
  const cheques = await get('cheques?select=id,numero,monto,fecha_deposito,estado,movimiento_id,socio_id,socios(numero_socio,nombre,apellido)&estado=eq.depositado')
  const pool = cheques.filter(c => !c.movimiento_id)
  console.log(`Pool de candidatos (depositados sin movimiento): ${pool.length}`)
  pool.forEach(c => console.log(`  N°${c.numero} ${c.socios?.numero_socio} | $${c.monto} | dep ${fmt(c.fecha_deposito)}`))

  const movs = await get('movimientos?select=id,fecha,descripcion,monto,tipo,estado,rut_detectado,socio_id,socios(numero_socio,nombre,apellido)&tipo=eq.abono')
  const depositos = movs.filter(esDepositoDeCheque)
  console.log(`\nMovimientos "Depósito Documento" existentes: ${depositos.length}`)
  for (const m of depositos) {
    const r = elegir(pool, m.socio_id, Math.abs(m.monto), m.fecha)
    const lbl = r.pick ? `N°${r.pick.numero}` : (r.empate ? 'EMPATE → diálogo sin preselección' : '0 candidatos → flujo normal')
    console.log(`  ${fmt(m.fecha)} ${m.socios?.numero_socio || 's/socio'} $${Math.abs(m.monto)} ${m.estado} → candidatos:${r.n} → ${lbl}`)
  }

  console.log('\nSimulación: depósito de junio para los cheques 2599437 / 7100184')
  for (const num of ['2599437', '7100184']) {
    const ch = cheques.find(x => x.numero === num)
    if (!ch) { console.log(`  (cheque ${num} no encontrado)`); continue }
    const r = elegir(pool, ch.socio_id, ch.monto, ch.fecha_deposito)
    const ok = r.pick && r.pick.numero === num ? '✓ CORRECTO' : '✗ revisar'
    console.log(`  Depósito S=${ch.socios?.numero_socio} $${ch.monto} fecha ${fmt(ch.fecha_deposito)} → candidatos:${r.n} → elige ${r.pick ? 'N°' + r.pick.numero : '(diálogo)'} ${ok}`)
  }
}
main().catch(e => { console.error('DRY-RUN error:', e.message); process.exit(1) })
