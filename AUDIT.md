# Propuesta de mejora — Teski Club

**Fecha:** 2026-05-12
**Versión:** 1.0
**Commit auditado:** pre-git _(el directorio no es un repositorio git todavía; cuando se inicialice, reemplazar por el SHA de `git rev-parse HEAD` al momento de la auditoría)_

> ⚠️ Las referencias a archivos y líneas (`Cartola.jsx:75`, etc.) reflejan el estado en la fecha de la auditoría. Tras el primer cambio pueden quedar obsoletas — **cada ítem debe re-verificarse contra el código vigente antes de ejecutarse**.

Documento de entrega para que Claude (u otro asistente) ejecute las mejoras. **No modifica código**; cada ítem tiene problema, propuesta, archivos afectados y criterios de aceptación. Ordenado por impacto.

---

## P0 — Bloqueantes / riesgos de datos

### 1. Reconciliar el `schema.sql` con la base real (+ seed)
- **Problema:** `supabase/schema.sql` documenta 5 tablas (`socios`, `beneficiarios`, `cartolas`, `movimientos`, `cuotas`). La app usa al menos 10 más (`cheques`, `chequera_detalle`, `incorporaciones`, `bancos`, `pagos_cuota`, `periodos_cuota`, `otros_ingresos`, vista `vista_socios` con columnas extra `comentarios`, `fecha_inactividad`, `fecha_nacimiento`). La tabla `cuotas` definida **no se usa**. El proyecto no es reproducible.
- **Propuesta:**
  1. Volcar el esquema real desde Supabase (`supabase db dump --schema-only > supabase/schema.sql` o, mejor, dividir en migraciones numeradas bajo `supabase/migrations/`).
  2. Eliminar la tabla `cuotas` del schema si efectivamente no se usa, o documentar por qué existe.
  3. **Crear `supabase/seed.sql`** con datos ficticios mínimos: 3–4 socios (con RUTs válidos), 1–2 beneficiarios cada uno, 5–6 movimientos bancarios (mezcla de abonos y cargos), 1 cheque, 1 período de cuota con sus pagos.
  4. Actualizar README con el procedimiento real de bootstrap.
- **Criterios de aceptación:**
  - Un usuario con cuenta Supabase nueva puede levantar la DB ejecutando lo que está en `supabase/`.
  - `grep -r "from('" src/` no encuentra tablas/vistas que falten en el schema.
  - `supabase db reset` deja el sistema navegable sin tener que cargar datos a mano: se puede entrar a `/socios`, `/cuotas`, `/cartola`, etc. y ver las pantallas pobladas.

### 2. Generar `numero_socio` en Postgres, no en el cliente
- **Problema:** `src/pages/Socios.jsx:73-75` calcula el siguiente número en el navegador con `Math.max(...socios.map(...))`. Dos sesiones concurrentes generan colisiones; además solo considera los socios cargados en memoria.
- **Propuesta:** crear secuencia `socios_numero_seq` o columna identidad + trigger que pueble `numero_socio` con formato `S-001`. Quitar el cálculo del frontend.
- **Orden de ejecución (importante — respetar esta secuencia):**
  1. Crear la secuencia y el trigger en una migración SQL.
  2. **Inmediatamente después**, arrancar la secuencia desde el máximo actual para evitar colisión con socios ya existentes:
     ```sql
     SELECT setval(
       'socios_numero_seq',
       (SELECT COALESCE(MAX(SUBSTRING(numero_socio FROM 3)::int), 0) FROM socios)
     );
     ```
     (Asume formato `S-NNN`; ajustar el `FROM 3` si cambia el prefijo.)
  3. Recién entonces, eliminar el bloque de cálculo en `Socios.jsx`.
- **Criterios de aceptación:**
  - El bloque cliente en `Socios.jsx:73-75` ya no existe.
  - `INSERT INTO socios (nombre, apellido, rut) VALUES (...)` desde SQL Editor genera un `numero_socio` único correlativo, **mayor que el máximo previo** (verificable: insertar y comprobar que el nuevo número es `max_anterior + 1`).
  - Test manual: dos pestañas creando socio simultáneamente → ambas tienen números distintos.

### 3. Validar dígito verificador del RUT auto-detectado desde cartola
- **Problema:** `src/lib/parsearCartola.js:102-112` (`extraerRutDesdeDescripcion`) asume que el último dígito de la cadena numérica al inicio de la descripción es el DV, **sin validar**. El calce automático puede asignar un abono a un socio equivocado si un folio/referencia coincide accidentalmente con un `socio.rut`.
- **Propuesta:** después de extraer `num` + `dv`, invocar `calcularDv(num)` (`src/lib/rut.js:7`) y descartar si no coincide. Si descarta, intentar calce por nombre (`extraerNombreDesdeDescripcion`).
- **Criterios de aceptación:**
  - Tests unitarios sobre `extraerRutDesdeDescripcion` con los siguientes casos:
    - `"12345678-5 Transf. Juan"` → devuelve el RUT formateado **solo si** `calcularDv('12345678') === '5'`.
    - `"12345678-9 Transf. Juan"` → devuelve `null` (DV no calza).
    - `"987654 Folio referencia"` → devuelve `null` (no es un RUT, longitud/DV no válidos).
  - Añadir log en consola cuando se descarta un RUT por DV inválido (para diagnóstico durante onboarding del feature).

### 4. Auditar políticas de Storage del bucket `cartolas`
- **Problema:** `schema.sql:124-127` solo concede `INSERT` y `SELECT`. La app llama `storage.from('cartolas').remove(...)` (`src/pages/Socios.jsx:143`) y `upload(..., { upsert: true })` en Chequera/Incorporaciones. Si funciona en prod es porque hay políticas no versionadas.
- **Propuesta:** revisar las políticas reales en Supabase y versionarlas. Mínimo: `DELETE` y `UPDATE` (para upsert) restringidas a `authenticated`. Considerar separar buckets: `cartolas/` (solo cartolas bancarias), `adjuntos-socios/`, `adjuntos-cheques/`.
- **Criterios de aceptación:**
  - `schema.sql` (o migración nueva) contiene las 4 políticas (`SELECT`/`INSERT`/`UPDATE`/`DELETE`).
  - Flujo de subir + borrar adjunto de socio funciona end-to-end.

### 5. Deduplicación al cargar cartola bancaria
- **Problema:** subir dos veces la misma cartola (caso operativo común, especialmente con archivos de "Últimos movimientos" que se solapan) puede duplicar movimientos. Duplicar abonos infla saldos y rompe la conciliación.
- **Estado actual (verificado en código):** hay **deduplicación parcial**:
  - `src/pages/Cartola.jsx:85-90` rechaza si ya existe una cartola con el mismo `nombre_archivo`.
  - `src/pages/Cartola.jsx:113-124` rechaza, para cartolas mensuales con `n_documento` real, si ya existe ese `n_documento` en la tabla `movimientos`.
  - **Gap:** las cartolas tipo "Últimos movimientos" usan un `n_documento` sintético (`um-${fecha}-${monto}`, `parsearCartola.js:73`) que **no se verifica contra la DB antes del insert**. Renombrar el archivo basta para saltar la dedup por nombre.
- **Propuesta:**
  1. Antes del insert masivo, calcular un hash determinístico por movimiento — `sha1(fecha + monto + descripcion_normalizada)` o equivalente — y verificar contra los movimientos ya cargados del mismo banco/cuenta en una ventana de ±N días (sugerido: 60).
  2. Si hay colisión, marcar como **duplicado candidato** y mostrar al usuario una vista previa con los movimientos sospechosos antes de insertar (no rechazar silenciosamente).
  3. Aplicar la regla también al path de "Últimos movimientos", no solo a la cartola mensual.
- **Criterios de aceptación:**
  - Subir la misma cartola dos veces (con nombre cambiado) no duplica movimientos.
  - Test unitario con dataset que incluye 2 cartolas con overlap parcial (las últimas N filas de la primera cartola = primeras N filas de la segunda) → el segundo upload solo inserta las filas nuevas.
  - Test manual: cambiar el nombre del archivo y re-subir → la app detecta y avisa.

---

## P1 — Bugs y deuda de correctitud

### 6. Conectar `useBancos` donde está cableado a lista fija
- **Problema:** existe un mantenedor completo de bancos (`/bancos`) y un hook `useBancos` (`src/lib/useBancos.js`). Pero `src/pages/Socios.jsx:259` usa lista hardcodeada `['Banco Estado','BCI','Santander','Scotiabank','Falabella','Itaú','Security']`. Mismo patrón a revisar en `Cheques.jsx:14-16` (defaults `'Banco Estado'`) y `Incorporaciones.jsx`.
- **Propuesta:** sustituir listas fijas por `useBancos()` ya invocado en `Socios.jsx:50` pero ignorado. Para los defaults de form, usar el primer banco activo o vacío.
- **Criterios de aceptación:**
  - `grep -n "Banco Estado','BCI'" src/` no encuentra ocurrencias.
  - Agregar un banco en `/bancos` aparece inmediatamente en los desplegables al recargar.

### 7. Enforzar límite de 5 beneficiarios por socio
- **Problema:** README promete "máximo 5 beneficiarios por socio". No hay validación ni en `Beneficiarios.jsx` ni en el schema.
- **Propuesta:**
  - Constraint en DB: trigger `BEFORE INSERT` que falle si `(SELECT count(*) FROM beneficiarios WHERE socio_id = NEW.socio_id AND estado = 'vigente') >= 5`.
  - Validación de UX en `Beneficiarios.jsx` antes de abrir el modal de "nuevo beneficiario".
- **Criterios de aceptación:**
  - Intentar agregar el 6º beneficiario muestra mensaje y no inserta.
  - Editar uno existente sigue funcionando (solo bloquea inserts nuevos).

### 8. Corregir año cuando la fecha viene sin año en cartola Santander
- **Problema:** `src/lib/parsearCartola.js:166-169` usa `new Date().getFullYear()` cuando el formato es `DD/MM`. En enero, al cargar movimientos de diciembre del año anterior, queda estampado el año actual.
- **Propuesta:** usar como referencia el año del primer movimiento con año explícito en la misma cartola, o derivarlo de la cabecera/periodo de la cartola. Si todo es `DD/MM`, aplicar regla: si `mes > mes_actual`, asumir año anterior.
- **Criterios de aceptación:** test unitario con dataset de prueba que mezcla diciembre+enero parsea correctamente.

### 9. Migrar parser de cartola a `readAsArrayBuffer`
- **Problema:** `src/pages/Cartola.jsx:75` usa `reader.readAsBinaryString` + `XLSX.read(..., { type: 'binary' })`. `readAsBinaryString` está marcado como obsoleto.
- **Propuesta:** `reader.readAsArrayBuffer(file)` + `XLSX.read(new Uint8Array(buf), { type: 'array', cellDates: true })`.
- **Criterios de aceptación:** carga de `.xls`, `.xlsx` y `.csv` reales funciona igual que hoy.

### 10. Condicional muerto en `handleAsignarSocio`
- **Problema:** `src/pages/Cartola.jsx:268`:
  ```js
  estado: socioId ? 'pendiente' : 'pendiente'
  ```
- **Propuesta:** decidir intención real. Probablemente debe ser `socioId ? 'pendiente' : 'sin_calce'` o similar; revisar con quien escribió la lógica.
- **Criterios de aceptación:** al desasignar socio de un movimiento, el filtro "sin calce" lo vuelve a mostrar.

### 11. Descarga de adjuntos: `<a download>` cross-origin no funciona
- **Problema:** `src/pages/Socios.jsx:153-161` crea un `<a>` con `href` apuntando a URL firmada de Supabase (cross-origin); el atributo `download` se ignora → el archivo se abre inline.
- **Propuesta:** alternativas:
  - `fetch(signedUrl).then(r => r.blob()).then(b => downloadBlob(b, filename))`.
  - O configurar `Content-Disposition: attachment; filename=...` desde Supabase Storage (`createSignedUrl` acepta `download: true` en versiones recientes).
- **Criterios de aceptación:** al hacer clic en "descargar", se descarga el archivo, no se abre.

### 12. Botón "Nuevo socio" del topbar
- **Problema:** `src/components/Layout.jsx:87` solo navega a `/socios`. Si el usuario ya está en `/socios`, no hace nada visible.
- **Propuesta:** o quitar el botón global (queda el que ya existe dentro de la página), o coordinar la apertura del modal vía query param (`?new=1`) o estado global.
- **Criterios de aceptación:** clic siempre abre el modal de nuevo socio.

### 13. `pathname.startsWith()` para título y resaltado de menú
- **Problema:** `src/components/Layout.jsx:41,58`. Hoy funciona porque ninguna ruta es prefijo de otra después del orden, pero `/cheques` y `/chequera` empiezan igual.
- **Propuesta:** comparar con `pathname === k || pathname.startsWith(k + '/')`.

---

## P2 — Seguridad y robustez operativa

### 14a. Definir matriz de permisos por rol _(entregable: documento, no código)_
- **Problema:** todas las políticas RLS son `auth.role() = 'authenticated'`. Cualquier usuario invitado puede borrar socios, cheques, conciliar pagos. Antes de implementar nada hay que decidir qué roles existen y qué pueden hacer.
- **Propuesta:** producir un documento (sugerido: `docs/permisos.md`) con una matriz **rol × acción × tabla**, cubriendo al menos:
  - Roles candidatos: `admin`, `tesorero`, `secretario`, `lector` (ajustar según necesidad real del club).
  - Acciones: ver, crear, editar, eliminar, conciliar, exportar.
  - Recursos: socios, beneficiarios, cuotas, cartolas, cheques, chequera, incorporaciones, bancos, reportería.
- **⚠️ Pausar y consultar al product owner antes de avanzar a 14b.** Las decisiones aquí condicionan políticas RLS y UI.
- **Criterios de aceptación:** existe `docs/permisos.md` con la matriz aprobada por el product owner (firmada/comentada en PR).

### 14b. Implementar roles en RLS y UI _(bloqueado por 14a)_
- **Problema:** una vez definida la matriz, hay que aplicarla.
- **Propuesta:** introducir `app_metadata.role` con los valores definidos en 14a. Migrar políticas a `auth.jwt() ->> 'role' = 'admin'` (etc.) para mutaciones; ajustar `loadXxx` y mostrar/ocultar botones en UI según rol del JWT.
- **Criterios de aceptación:** un usuario con rol `lector` no ve botones de eliminar y la DB rechaza si los invoca por API.
- **Nota:** cambio grande, transversal a todas las páginas. **No estimar en horas hasta tener 14a cerrada.**

### 15. Pinear Tabler Icons y servir local
- **Problema:** `index.html:7` carga `@tabler/icons-webfont@latest` desde jsdelivr. Render-blocking, sin offline, supply-chain abierto.
- **Propuesta:** `npm i @tabler/icons-webfont`, importar CSS desde `node_modules` en `main.jsx` o `index.css`. Pin a versión exacta.
- **Criterios de aceptación:** `index.html` no tiene `<link>` a cdn.jsdelivr; los iconos renderizan offline.

### 16. Protección contra formula injection en exports a Excel
- **Problema:** Reportería/Socios exportan con `xlsx`. Si un campo de texto (comentario, descripción) empieza con `=`, `+`, `-` o `@`, Excel lo interpreta como fórmula al abrirlo.
- **Propuesta — dos opciones:**
  - **(a)** Prefijar con apóstrofe (`'`) los campos string que empiecen con `=`, `+`, `-`, `@`. Es un fix mínimo pero contamina el dato visible en la celda.
  - **(b) _Recomendada_** — al construir celdas con `xlsx`, forzar tipo string explícito: `{ t: 's', v: text }` en vez de pasar el valor crudo. SheetJS respeta el tipo y Excel no interpreta como fórmula. Más limpio porque no altera el contenido visual.
- **Criterios de aceptación:** test unitario sobre el helper de export que verifique que `"=SUM(A1)"` se serializa como texto literal (`t: 's'`) y no como fórmula al abrirlo en Excel.

### 17. CSP y headers básicos en Vercel
- **Problema:** no hay headers de seguridad configurados.
- **Propuesta:** agregar `vercel.json` con `Content-Security-Policy` (permitiendo `*.supabase.co` para API y storage), `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`.
- **Criterios de aceptación:** `curl -I` contra el deploy muestra los headers.

### 18. Limpiar archivos basura del repo
- **Problema:**
  - Directorio `{src/{components,pages,lib},supabase}/` (mkdir con braces sin expandir).
  - `.DS_Store` en `src/`, `src/`, raíz.
  - `.gitignore` no excluye `.DS_Store` ni `*.log`.
- **Propuesta:** `rm -rf "{src"` (con cuidado por las llaves); ampliar `.gitignore`:
  ```
  node_modules
  dist
  .env
  .env.local
  .DS_Store
  *.log
  .vscode/
  .idea/
  ```
- **Criterios de aceptación:** `git status` limpio, no aparecen `.DS_Store`.

### 19. Backup periódico de la base
- **Problema:** el plan free de Supabase no incluye backups automáticos retenidos largo plazo. Para un sistema que registra movimientos de dinero del club, perder la DB es inaceptable.
- **Propuesta:** GitHub Action semanal (`schedule: cron`) que ejecute `pg_dump` contra el proyecto Supabase usando un connection string almacenado en Secrets, cifre el dump (gpg/age con passphrase también en Secrets) y lo suba a un bucket externo (Cloudflare R2, AWS S3, Google Drive) **o** lo commitee a un repo privado de backups separado. Rotación: mantener 12 semanas; borrar los más antiguos.
- **Criterios de aceptación:**
  - Existe `.github/workflows/backup.yml` con schedule weekly + trigger manual (`workflow_dispatch`).
  - Ejecutado manualmente desde la UI de Actions produce un dump válido que se puede listar en el destino.
  - Existe `docs/restore.md` con el procedimiento de restore paso a paso (descargar dump, descifrar, `psql` contra proyecto de staging, verificar conteos, swap de credenciales).

---

## P3 — Calidad de código y mantenibilidad

### 20. Romper páginas monolíticas
- **Problema:** `Cartola.jsx` 835 líneas, `Reporteria.jsx` 596, `Cuotas.jsx` 578.
- **Propuesta:** extraer subcomponentes — `<CartolaUploader/>`, `<ConciliacionRow/>`, `<ModalCalceManual/>`, `<TablaCheques/>`, etc. Idealmente cada archivo < 300 líneas.

### 21. Consolidar tokens de diseño _(nice to have — no bloqueante)_

#### 21a. Definir paleta completa en `:root` de `index.css`
- **Problema:** mezcla de variables CSS (`var(--gold)`) con hex sueltos (`#5dcaa5`, `#f09595`, `#fac775`) repetidos cientos de veces en `style={{}}`. Cambiar un color implica grep/replace global.
- **Propuesta:** auditar todos los hex literales usados en `src/`, agrupar por intención semántica (éxito, alerta, error, info, gold variants, etc.) y definirlos como variables CSS en `:root` dentro de `src/index.css`.
- **Criterios de aceptación:** `src/index.css` contiene la paleta consolidada con nombres semánticos; existe un comentario corto explicando la convención.

#### 21b. Migrar página por página al uso de variables
- **Problema:** una vez definida la paleta (21a), las páginas siguen con hex literales.
- **Propuesta:** reemplazar incrementalmente, archivo por archivo, los hex literales por `var(--...)`. Puede hacerse en commits separados, sin bloquear otros trabajos. Extraer también estilos repetidos (cards, badges, formularios) a clases CSS reutilizables — ya existen algunas (`.card`, `.btn`), continuar la migración.
- **Criterios de aceptación:** `grep -nE "#[0-9a-fA-F]{3,6}" src/` (excluyendo `index.css`) devuelve cada vez menos resultados. No hace falta cerrar el 100% en un solo PR.

### 22. Tooling de desarrollo
- **Problema:** sin ESLint, Prettier, tests, CI.
- **Propuesta:**
  - `eslint-config-react-app` o `@eslint/js` + `eslint-plugin-react-hooks` (catch dependencias de hooks faltantes — habrá hallazgos).
  - `prettier` con `.prettierrc` mínimo.
  - `vitest` + tests sobre módulos puros: `src/lib/rut.js`, `src/lib/montos.js`, `src/lib/parsearCartola.js`.
  - GitHub Actions: `lint + test` en cada push.
- **Criterios de aceptación:** `npm run lint && npm test` pasa en CI.

### 23. Observabilidad mínima
- **Problema:** muchos `catch (err) { showToast(err.message, 'error') }` tragan stacks. Solo hay un `console.error` en todo el repo (`src/pages/Cheques.jsx:51`).
- **Propuesta:** integrar Sentry (plan gratuito) o al menos capturar `console.error` + breadcrumb en cada catch antes del toast.

### 24. Paginación / lazy load
- **Problema:** `loadSocios`, `loadAllBeneficiarios`, `loadMovimientos`, `Reporteria.jsx` traen todo. Funciona hoy; arrastrará con crecimiento.
- **Propuesta:** paginación con `.range()` de Supabase + virtualización con `react-window` para listas largas. Implementar cuando un set supere 500 filas.

### 25. Filename sanitization en uploads
- **Problema:** `file.name` se concatena directo al path en Storage (`src/pages/Socios.jsx:135`, `Chequera.jsx`, `Incorporaciones.jsx`). Espacios, acentos y caracteres no `[\w.-]` pueden complicar URLs y descargas.
- **Verificación previa:** **antes de implementar**, comprobar si Supabase Storage ya sanitiza el filename del lado servidor (probar subiendo un archivo con acentos/espacios y revisar el path final almacenado).
  - **Si Supabase ya sanea correctamente:** bajar este ítem a una nota en README documentando la convención y **no implementar** helper.
  - **Si no sanea suficiente:** implementar `sanitizeFilename(name)` en `src/lib/` (quitar acentos vía `normalize('NFD').replace(/\p{Diacritic}/gu, '')`, espacios → `_`, eliminar caracteres no `[\w.-]`).
- **Criterios de aceptación:** subir un archivo con nombre `cartola enero — 2026 (ñ).xlsx` produce un path navegable y descargable, sin errores 404 ni URLs rotas.

---

## Entregables sugeridos por fase

> _Estimaciones revisadas: las anteriores eran optimistas; se incrementan ~50% para tener margen ante retrabajos y validaciones._

| Fase | Tareas | Tiempo estimado |
|------|--------|----------------|
| **Sprint 1 — Estabilizar** | #1, #2, #3, #4, #5 | 2–3 días |
| **Sprint 2 — Bugs visibles** | #6, #7, #8, #9, #10, #11, #12, #13 | 3 días |
| **Sprint 3 — Seguridad** | #14a, #15, #16, #17, #18, #19 | 1.5–3 días _(#14b queda fuera de estimación hasta que 14a esté aprobada)_ |
| **Sprint 4a — Tooling y tests** | #22, #23 | 1.5–2 días |
| **Sprint 4b — Refactor (con tests ya en su lugar)** | #20, #21a, #21b, #24, #25 | 3–5 días |

Sprint 4 se divide intencionalmente: hacer refactor (Sprint 4b) sin la red de seguridad de linter + tests (Sprint 4a) es regresar bugs sin darse cuenta.

---

## Instrucciones para Claude (entregable)

Al ejecutar este documento:

1. Trabajar **un ítem por commit** con mensaje `[Pn-#N] título`.
2. Antes de cada ítem, **leer los archivos referenciados** y confirmar que el problema sigue vigente (puede haber sido resuelto o las líneas pueden haberse movido).
3. **No introducir cambios fuera del scope del ítem** (sin refactors oportunistas).
4. Para ítems con DB: incluir migración SQL en `supabase/migrations/AAAAMMDD_descripcion.sql` y nota de cómo aplicarla.
5. Cualquier ítem que requiera decisiones de producto (ej. #10, #14a) → pausar y preguntar antes de implementar.
6. **Si un módulo crítico (`rut.js`, `montos.js`, `parsearCartola.js`) no tiene test cuando vas a modificarlo, escribir el test ANTES del cambio.** Asegura que el cambio no rompa un comportamiento no documentado.
7. **Toda migración SQL debe incluir `up` y `down`.** Si el `down` es destructivo (drop de columna con datos, drop de tabla) o imposible, marcarlo explícito en un comentario del archivo de migración y **pedir confirmación al usuario antes de aplicar**.
8. **Nunca tocar el proyecto Supabase de producción directamente.** Trabajar en una rama Supabase (`supabase branches create`) o en un proyecto de staging separado. Solo promover a producción cuando la migración y los criterios de aceptación pasen en staging.
