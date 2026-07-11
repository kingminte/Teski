// Edge Function: enviar-email
// "Cartero" genérico del módulo de avisos por email. Clon de enviar-cobranza
// (esa NO se toca), con CORS incluido de entrada.
// Envía un email transaccional vía Resend.
// Despliegue:
//   supabase functions deploy enviar-email
// Secretos (YA existen en el proyecto — compartidos con enviar-cobranza):
//   RESEND_API_KEY   (re_xxx)
//   RESEND_FROM      ("Teski Club <...@teskiclub.cl>", dominio verificado)

import "jsr:@supabase/functions-js/edge-runtime.d.ts"

// CORS: el navegador dispara un preflight OPTIONS antes del POST (por los
// headers authorization/content-type que manda supabase.functions.invoke).
// Sin estos headers + manejo de OPTIONS, el browser bloquea la llamada.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface Payload {
  destinatario: string
  asunto: string
  html: string
  copia?: string
}

Deno.serve(async (req: Request) => {
  // Preflight CORS: responder de inmediato, antes de cualquier otra lógica.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Método no permitido' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let body: Payload
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'JSON inválido' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { destinatario, asunto, html, copia } = body
  if (!destinatario || !asunto || !html) {
    return new Response(
      JSON.stringify({ error: 'destinatario, asunto y html son obligatorios' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  const apiKey = Deno.env.get('RESEND_API_KEY')
  const from = Deno.env.get('RESEND_FROM') ?? 'Teski Club <onboarding@resend.dev>'

  if (!apiKey) {
    return new Response(
      JSON.stringify({
        error: 'RESEND_API_KEY no configurada en secrets',
        hint: 'supabase secrets set RESEND_API_KEY=re_xxx',
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [destinatario],
      ...(copia ? { cc: [copia] } : {}),
      subject: asunto,
      html,
    }),
  })

  const data = await res.json().catch(() => ({}))

  if (!res.ok) {
    return new Response(
      JSON.stringify({ error: 'Resend rechazó el envío', detalle: data }),
      { status: res.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  return new Response(JSON.stringify({ ok: true, id: data.id }), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
