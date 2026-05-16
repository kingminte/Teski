# Teski Club — Sistema de Socios

Plataforma web para gestión de socios, beneficiarios y cuotas del Teski Club.

## Stack

- **Frontend**: React + Vite
- **Backend / DB**: Supabase (PostgreSQL)
- **Deploy**: Vercel
- **Parsing cartola**: SheetJS (xlsx)

---

## 1. Configurar Supabase (5 min)

1. Crea cuenta gratuita en https://supabase.com
2. Crea un nuevo proyecto (elige región "South America (São Paulo)")
3. Ve a **SQL Editor** y pega el contenido de `supabase/schema.sql` → Run
4. Ve a **Authentication → Users → Invite User** y crea tu usuario admin
5. Ve a **Project Settings → API** y copia:
   - `Project URL` → será `VITE_SUPABASE_URL`
   - `anon public key` → será `VITE_SUPABASE_ANON_KEY`

---

## 2. Subir código a GitHub (3 min)

1. Crea un repositorio nuevo en https://github.com
2. En tu computador, dentro de esta carpeta:

```bash
git init
git add .
git commit -m "Teski Club inicial"
git remote add origin https://github.com/TU_USUARIO/teski-club.git
git push -u origin main
```

---

## 3. Desplegar en Vercel (3 min)

1. Crea cuenta gratuita en https://vercel.com
2. Haz clic en "Add New Project" → importa tu repositorio de GitHub
3. En **Environment Variables** agrega:
   - `VITE_SUPABASE_URL` = la URL de tu proyecto Supabase
   - `VITE_SUPABASE_ANON_KEY` = la anon key de Supabase
4. Haz clic en **Deploy**
5. ¡Listo! Vercel te entrega una URL como `teski-club.vercel.app`

---

## Desarrollo local (opcional)

```bash
npm install
cp .env.example .env   # Edita .env con tus credenciales de Supabase
npm run dev            # Abre http://localhost:5173
```

---

## Uso del sistema

### Socios
- Registra socios con RUT, contacto, banco y valor de cuota
- Máximo 5 beneficiarios por socio

### Cartola bancaria
- Sube tu cartola en formato .xls, .xlsx o .csv
- El sistema detecta automáticamente los movimientos
- Intenta conciliar abonos con nombres de socios automáticamente
- Los abonos sin asignar se pueden conciliar manualmente con un menú desplegable

### Cuotas
- Genera las cuotas del mes con un clic (toma la lista de socios activos)
- Marca cuotas como pagadas manualmente o se concilian desde la cartola
- Puedes marcar socios en mora

---

## Estructura del proyecto

```
teski-club/
├── src/
│   ├── components/
│   │   └── Layout.jsx          # Sidebar + topbar
│   ├── pages/
│   │   ├── Login.jsx
│   │   ├── Dashboard.jsx
│   │   ├── Socios.jsx
│   │   ├── Beneficiarios.jsx
│   │   ├── Cartola.jsx
│   │   └── Cuotas.jsx
│   ├── lib/
│   │   ├── supabase.js         # Cliente Supabase
│   │   └── useToast.js         # Notificaciones
│   ├── App.jsx                 # Routing + auth
│   ├── main.jsx
│   └── index.css
├── supabase/
│   └── schema.sql              # Tablas, vistas y políticas RLS
├── .env.example
└── package.json
```
